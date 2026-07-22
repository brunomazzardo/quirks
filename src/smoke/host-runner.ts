import { execFile, spawn } from "node:child_process";
import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { loadRunnerProfiles } from "../runner/profiles.js";
import type { RunnerProfile } from "../runner/types.js";
import {
  blockedEvidence,
  isApprovedSmokeRun,
  persistEvidence,
  readEvidenceFile,
  validateHostRunnerEvidence,
} from "./evidence.js";
import type { HostRunnerEvidence, SmokeHost, SmokeHostConfig, SmokeRunner } from "./types.js";

const execFileAsync = promisify(execFile);
const DEFAULT_TASK_ID = "QK-101";
const HOST_TIMEOUT_MS = 300_000;
const DEFAULT_HOST_PATHS: Record<SmokeHost, string> = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor-agent",
};

export interface RunHostRunnerCellOptions {
  host: SmokeHost;
  runner: SmokeRunner;
  fixtureRoot: string;
  configDir: string;
  approved?: boolean;
  evidenceDir?: string;
  campaignCli?: string;
  stateDir?: string;
  hostExecutables?: Partial<Record<SmokeHost, string>>;
  orchestratorExecutable?: string;
  maxRetries?: number;
  taskId?: string;
}

export interface RunHostRunnerCellResult {
  evidence: HostRunnerEvidence;
  evidencePath?: string;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveExecutable(candidate: string): Promise<string | undefined> {
  if (path.isAbsolute(candidate)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      return undefined;
    }
  }
  const searchPath = process.env.PATH?.split(path.delimiter) ?? [];
  for (const directory of searchPath) {
    const absolute = path.join(directory, candidate);
    try {
      await access(absolute, constants.X_OK);
      return absolute;
    } catch {
      // continue
    }
  }
  return undefined;
}

async function readHostsConfig(configDir: string): Promise<SmokeHostConfig | undefined> {
  const hostsPath = path.join(configDir, "hosts.json");
  if (!(await pathExists(hostsPath))) return undefined;
  const parsed = JSON.parse(await readFile(hostsPath, "utf8")) as SmokeHostConfig;
  if (parsed.schemaVersion !== 1 || typeof parsed.hosts !== "object") {
    throw new Error("hosts.json must declare schemaVersion 1 and hosts");
  }
  return parsed;
}

async function resolveHostExecutable(
  host: SmokeHost,
  configDir: string,
  overrides?: Partial<Record<SmokeHost, string>>,
): Promise<string | undefined> {
  if (overrides?.[host]) {
    return resolveExecutable(overrides[host]!);
  }
  const hostsConfig = await readHostsConfig(configDir);
  const configured = hostsConfig?.hosts[host]?.executable;
  if (configured) {
    return resolveExecutable(configured);
  }
  return resolveExecutable(DEFAULT_HOST_PATHS[host]);
}

async function probeVersion(executable: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(executable, [...args], { timeout: 15_000 });
    const firstLine = stdout.trim().split("\n")[0] ?? executable;
    return firstLine.slice(0, 64);
  } catch {
    return "unknown";
  }
}

async function probeHostVersion(host: SmokeHost, executable: string): Promise<string> {
  switch (host) {
    case "claude":
      return probeVersion(executable, ["--version"]);
    case "codex":
      return probeVersion(executable, ["--version"]);
    case "cursor":
      return probeVersion(executable, ["--version"]);
  }
}

async function probeRunnerVersion(profile: RunnerProfile): Promise<string> {
  switch (profile.runnerType) {
    case "claude":
      return probeVersion(profile.executable, ["--version"]);
    case "codex":
      return probeVersion(profile.executable, ["--version"]);
    case "cursor":
      return probeVersion(profile.executable, ["--version"]);
  }
}

function reviewerFor(runner: SmokeRunner): SmokeRunner {
  if (runner === "claude") return "codex";
  if (runner === "codex") return "cursor";
  return "claude";
}

function profileIdFor(runner: SmokeRunner): string {
  return `smoke-implementer-${runner}`;
}

function reviewerProfileId(runner: SmokeRunner): string {
  return `smoke-reviewer-${reviewerFor(runner)}`;
}

export async function writeSmokeProfilesConfig(
  configDir: string,
  executables: Partial<Record<SmokeRunner, string>>,
  targetRunner: SmokeRunner,
): Promise<void> {
  await mkdir(configDir, { recursive: true });
  const fixtureDir = path.resolve("test/fixtures/fake-runners");
  const implementerExecutable = executables[targetRunner];
  const reviewerType = reviewerFor(targetRunner);
  const reviewerExecutable = executables[reviewerType];
  if (!implementerExecutable || !reviewerExecutable) {
    throw new Error(`Missing executables for smoke cell runner ${targetRunner}`);
  }

  const profiles: RunnerProfile[] = [
    {
      schemaVersion: 1,
      profileId: profileIdFor(targetRunner),
      runnerType: targetRunner,
      executable: implementerExecutable,
      accountAlias: "smoke",
      quotaPoolId: `pool-${targetRunner}`,
      tier: "standard",
      model: `smoke-${targetRunner}`,
      effort: "standard",
      capabilities: ["repository-read", "repository-write"],
      wallClockMs: 120_000,
      redactionRules: [],
    },
    {
      schemaVersion: 1,
      profileId: reviewerProfileId(targetRunner),
      runnerType: reviewerType,
      executable: reviewerExecutable,
      accountAlias: "smoke",
      quotaPoolId: `pool-reviewer-${targetRunner}`,
      tier: "high",
      model: `smoke-reviewer-${reviewerType}`,
      effort: "high",
      capabilities: ["repository-read"],
      wallClockMs: 120_000,
      redactionRules: [],
    },
  ];

  await cp(path.join(fixtureDir, "shared-modes.mjs"), path.join(configDir, "shared-modes.mjs"));
  await writeFile(
    path.join(configDir, "profiles.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      tierAliases: {
        "smoke-claude": { tier: "standard" },
        "smoke-codex": { tier: "standard" },
        "smoke-cursor": { tier: "standard" },
        "smoke-reviewer-claude": { tier: "high" },
        "smoke-reviewer-codex": { tier: "high" },
        "smoke-reviewer-cursor": { tier: "high" },
      },
      profiles,
    }, null, 2)}\n`,
    "utf8",
  );
}

export async function installSmokeHostExecutable(configDir: string): Promise<string> {
  const source = path.resolve("test/fixtures/fake-hosts/smoke-host.mjs");
  const target = path.join(configDir, "smoke-host.mjs");
  const contents = await readFile(source, "utf8");
  await writeFile(target, contents, "utf8");
  await chmod(target, 0o755);
  return target;
}

export async function writeSmokeHostsConfig(
  configDir: string,
  hostExecutables: Partial<Record<SmokeHost, string>>,
): Promise<void> {
  const hosts: SmokeHostConfig["hosts"] = {
    claude: { executable: hostExecutables.claude ?? DEFAULT_HOST_PATHS.claude },
    codex: { executable: hostExecutables.codex ?? DEFAULT_HOST_PATHS.codex },
    cursor: { executable: hostExecutables.cursor ?? DEFAULT_HOST_PATHS.cursor },
  };
  await writeFile(
    path.join(configDir, "hosts.json"),
    `${JSON.stringify({ schemaVersion: 1, hosts }, null, 2)}\n`,
    "utf8",
  );
}

export async function prepareSmokeFixtureRoot(root?: string): Promise<string> {
  const fixtureRoot = root ?? await mkdtemp(path.join(os.tmpdir(), "quirks-smoke-fixture-"));
  const fixture = path.resolve("test/fixtures/smoke-project");
  if (!(await pathExists(path.join(fixtureRoot, ".agents", "quirks.json")))) {
    await cp(fixture, fixtureRoot, { recursive: true });
    await execFileAsync("git", ["init", fixtureRoot]);
    await execFileAsync("git", ["-C", fixtureRoot, "config", "user.email", "smoke@quirks.test"]);
    await execFileAsync("git", ["-C", fixtureRoot, "config", "user.name", "Smoke Fixture"]);
    await execFileAsync("git", ["-C", fixtureRoot, "add", "."]);
    await execFileAsync("git", ["-C", fixtureRoot, "commit", "-m", "smoke fixture"]);
  }
  return fixtureRoot;
}

function buildHostBrief(input: {
  fixtureRoot: string;
  campaignCli: string;
  evidencePath: string;
  taskId: string;
}): string {
  return [
    "Run the Quirks campaign smoke flow for this repository.",
    `Repository root: ${input.fixtureRoot}`,
    `Campaign CLI: ${input.campaignCli}`,
    `Task id: ${input.taskId}`,
    `Evidence output path: ${input.evidencePath}`,
    "Steps:",
    "1. quirks-campaign preflight --task <task> --external-routing --json",
    "2. quirks-campaign approve --campaign <id> --digest <digest> --json",
    "3. quirks-campaign start --campaign <id> --json",
    "4. quirks-campaign status --campaign <id> --json",
    "Write only the bounded evidence JSON file at the evidence output path.",
    "Do not print secrets, home paths, or raw provider output.",
  ].join("\n");
}

function buildHostArgv(host: SmokeHost, executable: string, briefPath: string): string[] {
  switch (host) {
    case "claude":
      return [executable, "-p", "--output-format", "json", "--dangerously-skip-permissions", briefPath];
    case "codex":
      return [executable, "exec", "--json", briefPath];
    case "cursor":
      return [executable, "-p", "--output-format", "json", "--file", briefPath];
  }
}

function isTransientFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|EBUSY|ENOENT|EAGAIN|transient/i.test(message);
}

function isUsageLimit(evidence: HostRunnerEvidence): boolean {
  return evidence.outcome === "blocked" && evidence.deviations.some((entry) => /usage|quota|rate.?limit/i.test(entry));
}

async function spawnHostProcess(input: {
  argv: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<{ exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.argv[0]!, input.argv.slice(1), {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "ignore", "ignore"],
      shell: false,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut });
    });
  });
}

async function invokeHostCell(input: {
  host: SmokeHost;
  runner: SmokeRunner;
  fixtureRoot: string;
  configDir: string;
  stateDir: string;
  campaignCli: string;
  hostExecutable: string;
  hostVersion: string;
  runnerProfile: RunnerProfile;
  runnerVersion: string;
  evidencePath: string;
  briefPath: string;
  taskId: string;
}): Promise<HostRunnerEvidence> {
  const env = {
    ...process.env,
    QUIRKS_STATE_DIR: input.stateDir,
    QUIRKS_CONFIG_DIR: input.configDir,
    QUIRKS_SMOKE_CAMPAIGN_CLI: input.campaignCli,
    QUIRKS_SMOKE_FIXTURE_ROOT: input.fixtureRoot,
    QUIRKS_SMOKE_STATE_DIR: input.stateDir,
    QUIRKS_SMOKE_EVIDENCE_PATH: input.evidencePath,
    QUIRKS_SMOKE_HOST: input.host,
    QUIRKS_SMOKE_RUNNER: input.runner,
    QUIRKS_SMOKE_TASK_ID: input.taskId,
    QUIRKS_SMOKE_HOST_VERSION: input.hostVersion,
    QUIRKS_SMOKE_RUNNER_VERSION: input.runnerVersion,
    QUIRKS_SMOKE_MODEL: input.runnerProfile.model,
    QUIRKS_SMOKE_EFFORT: input.runnerProfile.effort,
  };

  const usesOrchestratorShim = path.basename(input.hostExecutable) === "smoke-host.mjs";
  const hostArgv = usesOrchestratorShim
    ? [input.hostExecutable]
    : buildHostArgv(input.host, input.hostExecutable, input.briefPath);

  const { exitCode, timedOut } = await spawnHostProcess({
    argv: hostArgv,
    cwd: input.fixtureRoot,
    env,
    timeoutMs: HOST_TIMEOUT_MS,
  });

  if (!(await pathExists(input.evidencePath))) {
    if (timedOut) {
      return blockedEvidence({
        host: input.host,
        runner: input.runner,
        reason: "host-timeout",
        hostVersion: input.hostVersion,
        runnerVersion: input.runnerVersion,
        profileId: input.runnerProfile.profileId,
      });
    }
    return blockedEvidence({
      host: input.host,
      runner: input.runner,
      reason: exitCode === 0 ? "missing-evidence" : "host-failed",
      hostVersion: input.hostVersion,
      runnerVersion: input.runnerVersion,
      profileId: input.runnerProfile.profileId,
    });
  }

  const evidence = await readEvidenceFile(input.evidencePath);
  return {
    ...evidence,
    host: input.host,
    runner: input.runner,
    hostVersion: input.hostVersion,
    runnerVersion: input.runnerVersion,
    profileId: input.runnerProfile.profileId,
    model: input.runnerProfile.model,
    effort: input.runnerProfile.effort,
  };
}

export async function runHostRunnerCell(options: RunHostRunnerCellOptions): Promise<RunHostRunnerCellResult> {
  const approved = isApprovedSmokeRun(options.approved);
  if (!approved) {
    return {
      evidence: blockedEvidence({
        host: options.host,
        runner: options.runner,
        reason: "missing-approval",
      }),
    };
  }

  const fixtureRoot = await prepareSmokeFixtureRoot(options.fixtureRoot);
  const stateDir = options.stateDir ?? await mkdtemp(path.join(os.tmpdir(), "quirks-smoke-state-"));
  const campaignCli = options.campaignCli ?? path.resolve("dist/src/cli/quirks-campaign.js");
  const taskId = options.taskId ?? DEFAULT_TASK_ID;
  const maxRetries = options.maxRetries ?? 1;

  const hostExecutable = await resolveHostExecutable(options.host, options.configDir, options.hostExecutables);
  if (!hostExecutable) {
    return {
      evidence: blockedEvidence({
        host: options.host,
        runner: options.runner,
        reason: "missing-host-cli",
      }),
    };
  }

  let profiles: readonly RunnerProfile[];
  try {
    profiles = await loadRunnerProfiles({ configDir: options.configDir });
  } catch {
    return {
      evidence: blockedEvidence({
        host: options.host,
        runner: options.runner,
        reason: "missing-profiles",
      }),
    };
  }

  const runnerProfile = profiles.find((profile) => profile.profileId === profileIdFor(options.runner));
  if (!runnerProfile) {
    return {
      evidence: blockedEvidence({
        host: options.host,
        runner: options.runner,
        reason: "missing-runner-profile",
      }),
    };
  }

  const hostVersion = await probeHostVersion(options.host, hostExecutable);
  const runnerVersion = await probeRunnerVersion(runnerProfile);
  const workDir = await mkdtemp(path.join(os.tmpdir(), "quirks-smoke-work-"));
  const evidencePath = path.join(workDir, "evidence.json");
  const briefPath = path.join(workDir, "host-brief.md");
  await writeFile(briefPath, buildHostBrief({
    fixtureRoot,
    campaignCli,
    evidencePath,
    taskId,
  }), "utf8");

  let lastEvidence: HostRunnerEvidence | undefined;
  let lastError: unknown;
  let useOrchestrator = false;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const activeHostExecutable = useOrchestrator
        ? (options.orchestratorExecutable ?? hostExecutable)
        : hostExecutable;
      const evidence = await invokeHostCell({
        host: options.host,
        runner: options.runner,
        fixtureRoot,
        configDir: options.configDir,
        stateDir,
        campaignCli,
        hostExecutable: activeHostExecutable,
        hostVersion,
        runnerProfile,
        runnerVersion,
        evidencePath,
        briefPath,
        taskId,
      });
      if (
        evidence.outcome !== "passed"
        && attempt < maxRetries
        && options.orchestratorExecutable
        && !useOrchestrator
      ) {
        useOrchestrator = true;
        lastEvidence = evidence;
        continue;
      }
      const finalEvidence = useOrchestrator && evidence.outcome === "passed"
        ? {
            ...evidence,
            deviations: [...evidence.deviations, "host-orchestrator-fallback"],
          }
        : evidence;
      validateHostRunnerEvidence(finalEvidence);
      let evidencePathWritten: string | undefined;
      if (options.evidenceDir) {
        evidencePathWritten = await persistEvidence(finalEvidence, options.evidenceDir);
      }
      await rm(workDir, { recursive: true, force: true });
      return { evidence: finalEvidence, ...(evidencePathWritten ? { evidencePath: evidencePathWritten } : {}) };
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        if (options.orchestratorExecutable && !useOrchestrator) {
          useOrchestrator = true;
          continue;
        }
        if (isTransientFailure(error)) continue;
      }
      break;
    }
  }

  if (lastEvidence) {
    let evidencePathWritten: string | undefined;
    if (options.evidenceDir) {
      evidencePathWritten = await persistEvidence(lastEvidence, options.evidenceDir);
    }
    await rm(workDir, { recursive: true, force: true });
    return { evidence: lastEvidence, ...(evidencePathWritten ? { evidencePath: evidencePathWritten } : {}) };
  }

  await rm(workDir, { recursive: true, force: true });
  const message = lastError instanceof Error ? lastError.message : "host-cell-failed";
  const evidence = blockedEvidence({
    host: options.host,
    runner: options.runner,
    reason: /usage|quota|rate.?limit/i.test(message) ? "usage-limit" : "host-cell-failed",
    hostVersion,
    runnerVersion,
    profileId: runnerProfile.profileId,
  });
  let evidencePathWritten: string | undefined;
  if (options.evidenceDir) {
    evidencePathWritten = await persistEvidence(evidence, options.evidenceDir);
  }
  return { evidence, ...(evidencePathWritten ? { evidencePath: evidencePathWritten } : {}) };
}

export function isUsageBlockedEvidence(evidence: HostRunnerEvidence): boolean {
  return isUsageLimit(evidence);
}
