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
const HOST_TIMEOUT_MS = 480_000;
const MAX_DIAGNOSTIC_CHARS = 480;
const SMOKE_BRIEF_RELATIVE_PATH = ".quirks/smoke/host-brief.md";
const SMOKE_EVIDENCE_RELATIVE_PATH = ".quirks/smoke/evidence.json";

export { SMOKE_BRIEF_RELATIVE_PATH, SMOKE_EVIDENCE_RELATIVE_PATH };

async function persistRepositoryBrief(fixtureRoot: string, briefContents: string): Promise<void> {
  const briefPath = path.join(fixtureRoot, SMOKE_BRIEF_RELATIVE_PATH);
  await mkdir(path.dirname(briefPath), { recursive: true });
  await writeFile(briefPath, briefContents, "utf8");
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Smoke Fixture",
    GIT_AUTHOR_EMAIL: "smoke@quirks.test",
    GIT_COMMITTER_NAME: "Smoke Fixture",
    GIT_COMMITTER_EMAIL: "smoke@quirks.test",
  };
  await execFileAsync("git", ["-C", fixtureRoot, "add", SMOKE_BRIEF_RELATIVE_PATH], { env: gitEnv });
  const { stdout } = await execFileAsync("git", ["-C", fixtureRoot, "status", "--porcelain"], { env: gitEnv });
  if (stdout.trim().length > 0) {
    await execFileAsync("git", ["-C", fixtureRoot, "commit", "-m", "smoke host brief"], { env: gitEnv });
  }
}
const DEFAULT_HOST_PATHS: Record<SmokeHost, string> = {
  claude: "claude",
  codex: "codex",
  cursor: "cursor-agent",
};

const COMMON_EXECUTABLE_DIRS = [
  path.join(os.homedir(), ".local", "bin"),
  path.join(os.homedir(), "bin"),
] as const;

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

export interface HostInvocation {
  argv: string[];
  stdin?: string;
}

export interface HostProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveExecutable(candidate: string): Promise<string | undefined> {
  if (path.isAbsolute(candidate)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      return undefined;
    }
  }

  const searchDirs = new Set<string>();
  for (const directory of process.env.PATH?.split(path.delimiter) ?? []) {
    if (directory.length > 0) searchDirs.add(directory);
  }
  for (const directory of COMMON_EXECUTABLE_DIRS) {
    searchDirs.add(directory);
  }

  for (const directory of searchDirs) {
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
  campaignCli: string;
  taskId: string;
  host: SmokeHost;
  runner: SmokeRunner;
}): string {
  const evidenceTemplate = {
    schemaVersion: 1,
    date: "YYYY-MM-DD",
    os: "platform-id",
    host: input.host,
    hostVersion: "from QUIRKS_SMOKE_HOST_VERSION",
    runner: input.runner,
    runnerVersion: "from QUIRKS_SMOKE_RUNNER_VERSION",
    model: "from QUIRKS_SMOKE_MODEL",
    effort: "from QUIRKS_SMOKE_EFFORT",
    profileId: `smoke-implementer-${input.runner}`,
    outcome: "passed",
    sessionAvailable: true,
    artifactDigest: "64-char-sha256-hex-from-campaign-result",
    deviations: [],
  };
  return [
    "Run the Quirks campaign smoke flow for this repository.",
    `Repository-local brief file: ${SMOKE_BRIEF_RELATIVE_PATH}`,
    `Campaign CLI: ${input.campaignCli}`,
    `Task id: ${input.taskId}`,
    `Evidence output path (repository-relative): ${SMOKE_EVIDENCE_RELATIVE_PATH}`,
    "Steps:",
    `1. node ${input.campaignCli} preflight --task ${input.taskId} --external-routing --json`,
    "2. node <campaign-cli> approve --campaign <id> --digest <digest> --json",
    "3. node <campaign-cli> start --campaign <id> --json",
    "4. node <campaign-cli> status --campaign <id> --json",
    "After the campaign flow completes, write ONLY the bounded smoke evidence JSON below to the evidence output path.",
    "Write the evidence file last, then exit.",
    "Do not include secrets, absolute home paths, raw provider stdout/stderr, or prompt bodies in the evidence file.",
    "Required evidence JSON schema:",
    JSON.stringify(evidenceTemplate, null, 2),
  ].join("\n");
}

export function buildHostInvocation(
  host: SmokeHost,
  executable: string,
  briefContents: string,
  fixtureRoot: string,
): HostInvocation {
  switch (host) {
    case "claude":
      return {
        argv: [
          executable,
          "-p",
          "--output-format",
          "json",
          "--allow-dangerously-skip-permissions",
          "--dangerously-skip-permissions",
          "--add-dir",
          fixtureRoot,
        ],
        stdin: briefContents,
      };
    case "codex":
      return {
        argv: [executable, "exec", "--json", "-C", fixtureRoot, "-"],
        stdin: briefContents,
      };
    case "cursor":
      return {
        argv: [
          executable,
          "-p",
          "--output-format",
          "json",
          "-f",
          "--trust",
          "--workspace",
          fixtureRoot,
          briefContents,
        ],
      };
  }
}

export function redactDiagnostic(text: string): string {
  const homeDir = os.homedir();
  let redacted = text.split(homeDir).join("~");
  redacted = redacted.replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [redacted]");
  redacted = redacted.replace(/\bsk-[A-Za-z0-9]{16,}\b/g, "sk-[redacted]");
  return redacted.trim().replace(/\s+/g, " ");
}

export function classifyHostDiagnostics(process: HostProcessResult): string[] {
  const deviations: string[] = [];
  if (process.timedOut) return deviations;
  if (process.exitCode !== null && process.exitCode !== 0) {
    deviations.push(`host-exit:${process.exitCode}`);
  }
  const stderr = redactDiagnostic(process.stderr);
  const stdout = redactDiagnostic(process.stdout);
  const combined = `${stderr}\n${stdout}`;

  if (/codex_models_manager|supports_reasoning_summaries/i.test(combined)) {
    deviations.push("codex-models-cache-error");
  }
  if (/usage.?limit|rate.?limit|quota/i.test(combined)) {
    deviations.push("usage-limit");
  }
  if (/ENOENT|command not found/i.test(combined)) {
    deviations.push("host-cli-missing");
  }
  if (stderr.length > 0 && /error|failed|fatal/i.test(stderr)) {
    if (!deviations.includes("codex-models-cache-error")) {
      deviations.push("host-stderr-error");
    }
  }
  if (stdout.length > 0 && /"type":"error"|orchestration-failed/i.test(stdout)) {
    deviations.push("host-stdout-error");
  }
  return deviations;
}

async function writeHostDebugCapture(
  debugDir: string,
  host: SmokeHost,
  runner: SmokeRunner,
  process: HostProcessResult,
): Promise<void> {
  const debugPath = path.join(debugDir, `host-capture-${host}-${runner}.log`);
  const body = [
    `exitCode=${process.exitCode}`,
    `timedOut=${process.timedOut}`,
    "--- stdout ---",
    process.stdout,
    "--- stderr ---",
    process.stderr,
  ].join("\n");
  await writeFile(debugPath, body, "utf8");
}

function isTransientFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|EBUSY|ENOENT|EAGAIN|transient/i.test(message);
}

function isUsageLimit(evidence: HostRunnerEvidence): boolean {
  return evidence.outcome === "blocked" && evidence.deviations.some((entry) => /usage|quota|rate.?limit/i.test(entry));
}

function boundedStreamText(chunks: readonly Buffer[]): string {
  const combined = Buffer.concat(chunks).toString("utf8");
  return combined.slice(0, MAX_DIAGNOSTIC_CHARS * 2);
}

export async function spawnHostProcess(input: {
  argv: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  stdin?: string;
}): Promise<HostProcessResult> {
  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = spawn(input.argv[0]!, input.argv.slice(1), {
      cwd: input.cwd,
      env: input.env,
      stdio: [input.stdin ? "pipe" : "ignore", "pipe", "pipe"],
      shell: false,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    if (input.stdin && child.stdin) {
      child.stdin.write(input.stdin);
      child.stdin.end();
    }

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        timedOut,
        stdout: boundedStreamText(stdoutChunks),
        stderr: boundedStreamText(stderrChunks),
      });
    });
  });
}

function applyOrchestratorFallbackOutcome(
  evidence: HostRunnerEvidence,
  priorAttempt?: HostRunnerEvidence,
): HostRunnerEvidence {
  const priorDeviations = priorAttempt?.deviations ?? [];
  const fallbackDeviations = evidence.deviations.filter((entry) => entry !== "host-orchestrator-fallback");
  return {
    ...evidence,
    outcome: "blocked",
    deviations: [
      ...priorDeviations,
      ...fallbackDeviations,
      "host-orchestrator-fallback",
    ],
  };
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
  briefContents: string;
  taskId: string;
  debugDir?: string;
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
  const invocation = usesOrchestratorShim
    ? { argv: [input.hostExecutable] }
    : buildHostInvocation(input.host, input.hostExecutable, input.briefContents, input.fixtureRoot);

  const processResult = await spawnHostProcess({
    argv: invocation.argv,
    cwd: input.fixtureRoot,
    env,
    timeoutMs: HOST_TIMEOUT_MS,
    ...(invocation.stdin ? { stdin: invocation.stdin } : {}),
  });

  if (!(await pathExists(input.evidencePath))) {
    const diagnostics = classifyHostDiagnostics(processResult);
    if (input.debugDir) {
      await writeHostDebugCapture(input.debugDir, input.host, input.runner, processResult).catch(() => undefined);
    }
    if (processResult.timedOut) {
      return blockedEvidence({
        host: input.host,
        runner: input.runner,
        reason: "host-timeout",
        hostVersion: input.hostVersion,
        runnerVersion: input.runnerVersion,
        profileId: input.runnerProfile.profileId,
        extraDeviations: diagnostics,
      });
    }
    return blockedEvidence({
      host: input.host,
      runner: input.runner,
      reason: processResult.exitCode === 0 ? "missing-evidence" : "host-failed",
      hostVersion: input.hostVersion,
      runnerVersion: input.runnerVersion,
      profileId: input.runnerProfile.profileId,
      extraDeviations: diagnostics,
    });
  }

  const evidence = await readEvidenceFile(input.evidencePath).catch(() => undefined);
  if (!evidence) {
    const diagnostics = classifyHostDiagnostics(processResult);
    if (input.debugDir) {
      await writeHostDebugCapture(input.debugDir, input.host, input.runner, processResult).catch(() => undefined);
    }
    return blockedEvidence({
      host: input.host,
      runner: input.runner,
      reason: "invalid-evidence",
      hostVersion: input.hostVersion,
      runnerVersion: input.runnerVersion,
      profileId: input.runnerProfile.profileId,
      extraDeviations: diagnostics,
    });
  }
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
  const debugDir = await mkdtemp(path.join(os.tmpdir(), "quirks-smoke-debug-"));
  const evidencePath = path.join(fixtureRoot, SMOKE_EVIDENCE_RELATIVE_PATH);
  const briefContents = buildHostBrief({
    campaignCli,
    taskId,
    host: options.host,
    runner: options.runner,
  });
  await persistRepositoryBrief(fixtureRoot, briefContents);
  await mkdir(path.dirname(evidencePath), { recursive: true });

  let lastEvidence: HostRunnerEvidence | undefined;
  let lastError: unknown;
  let useOrchestrator = false;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      await rm(evidencePath, { force: true });
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
        briefContents,
        taskId,
        debugDir,
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
      const finalEvidence = useOrchestrator
        ? applyOrchestratorFallbackOutcome(evidence, lastEvidence)
        : evidence;
      validateHostRunnerEvidence(finalEvidence);
      let evidencePathWritten: string | undefined;
      if (options.evidenceDir) {
        evidencePathWritten = await persistEvidence(finalEvidence, options.evidenceDir);
      }
      await rm(debugDir, { recursive: true, force: true });
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
    const finalEvidence = applyOrchestratorFallbackOutcome(lastEvidence);
    let evidencePathWritten: string | undefined;
    if (options.evidenceDir) {
      evidencePathWritten = await persistEvidence(finalEvidence, options.evidenceDir);
    }
    await rm(debugDir, { recursive: true, force: true });
    return { evidence: finalEvidence, ...(evidencePathWritten ? { evidencePath: evidencePathWritten } : {}) };
  }

  await rm(debugDir, { recursive: true, force: true });
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
