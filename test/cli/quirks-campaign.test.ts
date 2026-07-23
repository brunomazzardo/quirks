import assert from "node:assert/strict";
import test from "node:test";
import { CampaignCliParseError, parseCampaignArgs } from "../../src/cli/campaign-args.js";
import { runCampaignCommand } from "../../src/cli/campaign-commands.js";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";
import { CampaignStore } from "../../src/campaign/store.js";
import type { CampaignStatus } from "../../src/campaign/types.js";
import { loadProjectContext } from "../../src/project/config.js";
import { campaignEnvelope } from "../campaign/support.js";
import { execFile } from "node:child_process";
import { chmod, cp, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { isCliEntryInvocation } from "../../src/cli/quirks-campaign.js";

const execFileAsync = promisify(execFile);

async function executableFakeRunner(scriptName: string, configDir: string): Promise<string> {
  const fixtureDir = path.resolve("test/fixtures/fake-runners");
  await cp(path.join(fixtureDir, "shared-modes.mjs"), path.join(configDir, "shared-modes.mjs"));
  const source = path.join(fixtureDir, scriptName);
  const target = path.join(configDir, scriptName);
  const original = await readFile(source, "utf8");
  await writeFile(target, `#!/usr/bin/env node\n${original}`, "utf8");
  await chmod(target, 0o755);
  return target;
}

async function writeCampaignRunnerConfig(configDir: string): Promise<void> {
  await mkdir(configDir, { recursive: true });
  const codexExecutable = await executableFakeRunner("fake-codex.mjs", configDir);
  const claudeExecutable = await executableFakeRunner("fake-claude.mjs", configDir);
  await writeFile(
    path.join(configDir, "profiles.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      tierAliases: {
        "fable-principal": { tier: "principal" },
        "composer-standard": { tier: "standard" },
      },
      profiles: [
        {
          schemaVersion: 1,
          profileId: "codex-standard",
          runnerType: "codex",
          executable: codexExecutable,
          accountAlias: "work",
          quotaPoolId: "pool-codex",
          tier: "standard",
          model: "composer-standard",
          effort: "standard",
          capabilities: ["repository-read", "repository-write"],
          wallClockMs: 5_000,
          redactionRules: [],
        },
        {
          schemaVersion: 1,
          profileId: "claude-principal",
          runnerType: "claude",
          executable: claudeExecutable,
          accountAlias: "work",
          quotaPoolId: "pool-claude",
          tier: "principal",
          model: "fable-principal",
          effort: "principal",
          capabilities: ["repository-read", "repository-write"],
          wallClockMs: 5_000,
          redactionRules: [],
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
}

test("parseCampaignArgs accepts documented command shapes", () => {
  assert.deepEqual(parseCampaignArgs(["preflight", "--task", "QK-1", "--json"]), {
    command: "preflight",
    taskIds: ["QK-1"],
    externalRouting: false,
    json: true,
  });
  assert.deepEqual(parseCampaignArgs(["approve", "--campaign", "cmp-1", "--digest", "sha256:abc"]), {
    command: "approve",
    campaignId: "cmp-1",
    digest: "sha256:abc",
    json: false,
  });
  assert.deepEqual(parseCampaignArgs(["start", "--campaign", "cmp-1", "--json"]), {
    command: "start",
    campaignId: "cmp-1",
    singleWave: false,
    json: true,
  });
  assert.deepEqual(parseCampaignArgs(["start", "--campaign", "cmp-1", "--single-wave"]), {
    command: "start",
    campaignId: "cmp-1",
    singleWave: true,
    json: false,
  });
  assert.deepEqual(parseCampaignArgs(["preflight", "--task", "QK-1", "--max-concurrency", "3", "--json"]), {
    command: "preflight",
    taskIds: ["QK-1"],
    externalRouting: false,
    maxConcurrency: 3,
    json: true,
  });
  assert.deepEqual(parseCampaignArgs(["cancel", "--campaign", "cmp-1", "--scope", "job-1"]), {
    command: "cancel",
    campaignId: "cmp-1",
    scope: "job-1",
    json: false,
  });
  assert.deepEqual(parseCampaignArgs(["resume-candidate", "--json"]), {
    command: "resume-candidate",
    json: true,
  });
});

test("resume-candidate accepts only --json", () => {
  assert.throws(() => parseCampaignArgs(["resume-candidate", "--campaign", "cmp-1"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["resume-candidate", "extra"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["resume-candidate", "--json", "--json"]), CampaignCliParseError);
});

test("parseCampaignArgs rejects unknown commands and missing flags", () => {
  assert.throws(() => parseCampaignArgs([]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["explode"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["preflight"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["approve", "--campaign", "cmp-1"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["preflight", "--task", "QK-1", "--max-concurrency", "0"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["preflight", "--task", "QK-1", "--max-concurrency", "three"]), CampaignCliParseError);
  assert.throws(
    () => parseCampaignArgs(["preflight", "--task", "QK-1", "--max-concurrency", "2", "--max-concurrency", "2"]),
    CampaignCliParseError,
  );
  assert.throws(
    () => parseCampaignArgs(["start", "--campaign", "cmp-1", "--single-wave", "--single-wave"]),
    CampaignCliParseError,
  );
});

async function freshAcceptanceRepo(): Promise<{ root: string; stateDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-"));
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-state-"));
  const fixture = path.resolve("test/fixtures/campaign-project");
  await cp(fixture, root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Quirks Test"]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "fixture"]);
  return { root, stateDir };
}

test("runCampaignCommand preflight approve start status flow uses real runtime with fake executables", async () => {
  const { root, stateDir } = await freshAcceptanceRepo();
  const configDir = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-config-"));
  await writeCampaignRunnerConfig(configDir);
  const previousStateDir = process.env.QUIRKS_STATE_DIR;
  const previousConfigDir = process.env.QUIRKS_CONFIG_DIR;
  process.env.QUIRKS_STATE_DIR = stateDir;
  process.env.QUIRKS_CONFIG_DIR = configDir;
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const preflight = (await runCampaignCommand({
      command: "preflight",
      taskIds: ["QK-100"],
      externalRouting: false,
      json: true,
    })) as { ok: boolean; campaignId: string; envelope: { digest: string }; blockers: string[] };
    assert.equal(preflight.ok, false);
    assert.ok(preflight.blockers.length > 0);

    const tasksPath = path.join(root, ".quirks/tasks.json");
    const tasksDoc = JSON.parse(await readFile(tasksPath, "utf8")) as {
      tasks: Array<{ id: string; status: string }>;
    };
    const designTask = tasksDoc.tasks.find((task) => task.id === "QK-100");
    assert.ok(designTask);
    designTask.status = "completed";
    await writeFile(tasksPath, `${JSON.stringify(tasksDoc, null, 2)}\n`, "utf8");
    await execFileAsync("git", ["-C", root, "add", ".quirks/tasks.json"]);
    await execFileAsync("git", ["-C", root, "commit", "-m", "complete design dependency"]);
    const cleanAfterDesign = (await runCampaignCommand({
      command: "preflight",
      taskIds: ["QK-200"],
      externalRouting: true,
      json: true,
    })) as { ok: boolean; campaignId: string; envelope: { digest: string; routing: Record<string, { primary: { profileId: string } }> } };
    assert.equal(cleanAfterDesign.ok, true);
    assert.equal(cleanAfterDesign.envelope.routing["QK-200"]?.primary.profileId, "codex-standard");

    const approve = (await runCampaignCommand({
      command: "approve",
      campaignId: cleanAfterDesign.campaignId,
      digest: cleanAfterDesign.envelope.digest,
      json: true,
    })) as { ok: boolean };
    assert.equal(approve.ok, true);

    const start = (await runCampaignCommand({
      command: "start",
      campaignId: cleanAfterDesign.campaignId,
      singleWave: false,
      json: true,
    })) as { ok: boolean; dispatchedJobs: unknown[]; outcome?: { status: string } };
    assert.equal(start.ok, true);
    assert.ok(start.dispatchedJobs.length >= 1);
    assert.equal(start.outcome?.status, "completed");

    const status = (await runCampaignCommand({
      command: "status",
      campaignId: cleanAfterDesign.campaignId,
      json: true,
    })) as { localCoordinationOnly: boolean; status: string };
    assert.equal(status.localCoordinationOnly, true);
    assert.equal(status.status, "running");
  } finally {
    process.chdir(previousCwd);
    if (previousStateDir === undefined) delete process.env.QUIRKS_STATE_DIR;
    else process.env.QUIRKS_STATE_DIR = previousStateDir;
    if (previousConfigDir === undefined) delete process.env.QUIRKS_CONFIG_DIR;
    else process.env.QUIRKS_CONFIG_DIR = previousConfigDir;
  }
});

test("preflight re-staging lets a config-fix-and-retry loop reach an approvable envelope", async () => {
  const { root, stateDir } = await freshAcceptanceRepo();
  const configDir = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-config-"));
  await writeCampaignRunnerConfig(configDir);
  const previousStateDir = process.env.QUIRKS_STATE_DIR;
  const previousConfigDir = process.env.QUIRKS_CONFIG_DIR;
  process.env.QUIRKS_STATE_DIR = stateDir;
  process.env.QUIRKS_CONFIG_DIR = configDir;
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    // First staging attempt: placeholder routing lands in the store.
    const placeholderRun = (await runCampaignCommand({
      command: "preflight",
      taskIds: ["QK-101"],
      externalRouting: false,
      json: true,
    })) as { ok: boolean; campaignId: string; envelope: { digest: string } };
    assert.equal(placeholderRun.ok, true);

    // Operator fixes routing config and retries: same campaign, fresh envelope.
    const realRun = (await runCampaignCommand({
      command: "preflight",
      taskIds: ["QK-101"],
      externalRouting: true,
      json: true,
    })) as { ok: boolean; campaignId: string; envelope: { digest: string } };
    assert.equal(realRun.ok, true);
    assert.equal(realRun.campaignId, placeholderRun.campaignId);
    assert.notEqual(realRun.envelope.digest, placeholderRun.envelope.digest);

    // Approving the stale digest must fail loudly, naming the stored digest.
    await assert.rejects(
      () => runCampaignCommand({
        command: "approve",
        campaignId: placeholderRun.campaignId,
        digest: placeholderRun.envelope.digest,
        json: true,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /DIGEST_MISMATCH/);
        assert.ok(
          error.message.includes(realRun.envelope.digest),
          "approve failure must surface the stored envelope digest",
        );
        return true;
      },
    );

    // Approving the stored (fresh) digest succeeds without state-dir surgery.
    const approve = (await runCampaignCommand({
      command: "approve",
      campaignId: realRun.campaignId,
      digest: realRun.envelope.digest,
      json: true,
    })) as { ok: boolean };
    assert.equal(approve.ok, true);

    const status = (await runCampaignCommand({
      command: "status",
      campaignId: realRun.campaignId,
      json: true,
    })) as { envelopeDigest: string; digest: string };
    assert.equal(status.envelopeDigest, realRun.envelope.digest);
    assert.equal(status.digest, realRun.envelope.digest);
  } finally {
    process.chdir(previousCwd);
    if (previousStateDir === undefined) delete process.env.QUIRKS_STATE_DIR;
    else process.env.QUIRKS_STATE_DIR = previousStateDir;
    if (previousConfigDir === undefined) delete process.env.QUIRKS_CONFIG_DIR;
    else process.env.QUIRKS_CONFIG_DIR = previousConfigDir;
  }
});

test("runCampaignCommand start --single-wave preserves the single-dispatch behavior", async () => {
  const { root, stateDir } = await freshAcceptanceRepo();
  const configDir = await mkdtemp(path.join(os.tmpdir(), "quirks-cli-config-"));
  await writeCampaignRunnerConfig(configDir);
  const previousStateDir = process.env.QUIRKS_STATE_DIR;
  const previousConfigDir = process.env.QUIRKS_CONFIG_DIR;
  process.env.QUIRKS_STATE_DIR = stateDir;
  process.env.QUIRKS_CONFIG_DIR = configDir;
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const preflight = (await runCampaignCommand({
      command: "preflight",
      taskIds: ["QK-101"],
      externalRouting: true,
      json: true,
    })) as { ok: boolean; campaignId: string; envelope: { digest: string } };
    assert.equal(preflight.ok, true);

    await runCampaignCommand({
      command: "approve",
      campaignId: preflight.campaignId,
      digest: preflight.envelope.digest,
      json: true,
    });

    const start = (await runCampaignCommand({
      command: "start",
      campaignId: preflight.campaignId,
      singleWave: true,
      json: true,
    })) as { ok: boolean; dispatchedJobs: unknown[]; outcome?: unknown };
    assert.equal(start.ok, true);
    assert.ok(start.dispatchedJobs.length >= 1);
    assert.equal(start.outcome, undefined);

    const status = (await runCampaignCommand({
      command: "status",
      campaignId: preflight.campaignId,
      json: true,
    })) as { status: string };
    assert.equal(status.status, "running");
  } finally {
    process.chdir(previousCwd);
    if (previousStateDir === undefined) delete process.env.QUIRKS_STATE_DIR;
    else process.env.QUIRKS_STATE_DIR = previousStateDir;
    if (previousConfigDir === undefined) delete process.env.QUIRKS_CONFIG_DIR;
    else process.env.QUIRKS_CONFIG_DIR = previousConfigDir;
  }
});

async function seedStoredCampaign(options: {
  stateDir: string;
  repositoryId: string;
  campaignId: string;
  status: CampaignStatus;
  updatedAt: string;
  withPausedEvent?: boolean;
}): Promise<void> {
  const incomplete = campaignEnvelope({
    campaignId: options.campaignId,
    repositoryId: options.repositoryId,
  });
  const envelope = { ...incomplete, digest: computeEnvelopeDigest(stripDigest(incomplete)) };
  const store = await CampaignStore.create({
    stateDir: options.stateDir,
    repositoryId: options.repositoryId,
    campaignId: options.campaignId,
    envelope,
  });
  if (options.withPausedEvent) {
    await store.appendEvent({
      schemaVersion: 1,
      id: `seed:${options.campaignId}:paused`,
      type: "campaign.paused",
      at: options.updatedAt,
      actor: "control-plane",
      from: "running",
      to: "paused",
      reason: "crash_recovery_revalidation",
      evidence: {},
    });
  }
  await store.writeState({
    schemaVersion: 1,
    campaignId: options.campaignId,
    status: options.status,
    digest: envelope.digest,
    updatedAt: options.updatedAt,
  });
}

test("resume-candidate returns the paused campaign with its last event", async () => {
  const { root, stateDir } = await freshAcceptanceRepo();
  const previousStateDir = process.env.QUIRKS_STATE_DIR;
  process.env.QUIRKS_STATE_DIR = stateDir;
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const context = await loadProjectContext(root, { mode: "inspection" });
    await seedStoredCampaign({
      stateDir,
      repositoryId: context.repositoryId,
      campaignId: "cmp-resume-a",
      status: "paused",
      updatedAt: "2026-07-22T02:00:00.000Z",
      withPausedEvent: true,
    });
    await seedStoredCampaign({
      stateDir,
      repositoryId: context.repositoryId,
      campaignId: "cmp-resume-b",
      status: "cancelled",
      updatedAt: "2026-07-22T03:00:00.000Z",
    });

    const result = await runCampaignCommand({ command: "resume-candidate", json: true });
    assert.deepEqual(result, {
      ok: true,
      available: true,
      campaign: {
        id: "cmp-resume-a",
        status: "paused",
        lastEvent: { type: "campaign.paused", at: "2026-07-22T02:00:00.000Z" },
      },
    });
  } finally {
    process.chdir(previousCwd);
    if (previousStateDir === undefined) delete process.env.QUIRKS_STATE_DIR;
    else process.env.QUIRKS_STATE_DIR = previousStateDir;
  }
});

test("resume-candidate prefers the most recently updated non-terminal campaign", async () => {
  const { root, stateDir } = await freshAcceptanceRepo();
  const previousStateDir = process.env.QUIRKS_STATE_DIR;
  process.env.QUIRKS_STATE_DIR = stateDir;
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const context = await loadProjectContext(root, { mode: "inspection" });
    await seedStoredCampaign({
      stateDir,
      repositoryId: context.repositoryId,
      campaignId: "cmp-older",
      status: "running",
      updatedAt: "2026-07-22T01:00:00.000Z",
    });
    await seedStoredCampaign({
      stateDir,
      repositoryId: context.repositoryId,
      campaignId: "cmp-newer",
      status: "awaiting_approval",
      updatedAt: "2026-07-22T04:00:00.000Z",
    });

    const result = (await runCampaignCommand({ command: "resume-candidate", json: true })) as {
      available: boolean;
      campaign?: { id: string; status: string; lastEvent: unknown };
    };
    assert.equal(result.available, true);
    assert.deepEqual(result.campaign, { id: "cmp-newer", status: "awaiting_approval", lastEvent: null });
  } finally {
    process.chdir(previousCwd);
    if (previousStateDir === undefined) delete process.env.QUIRKS_STATE_DIR;
    else process.env.QUIRKS_STATE_DIR = previousStateDir;
  }
});

test("isCliEntryInvocation recognizes direct, symlinked, and non-entry argv[1]", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-entry-guard-"));
  const modulePath = path.join(dir, "cli.js");
  await writeFile(modulePath, "export {};\n", "utf8");
  const moduleUrl = pathToFileURL(modulePath).href;

  // Direct invocation: argv[1] is the module path itself.
  assert.equal(isCliEntryInvocation(moduleUrl, modulePath), true);

  // npm-style bin shim: argv[1] is a symlink to the module (Node resolves the
  // main module through symlinks, so the module URL is the real path).
  const binLink = path.join(dir, "bin-shim");
  await symlink(modulePath, binLink);
  assert.equal(isCliEntryInvocation(moduleUrl, binLink), true);

  // Not the entry point: a different file, or no argv[1] at all (node -e, REPL).
  assert.equal(isCliEntryInvocation(moduleUrl, path.join(dir, "other.js")), false);
  assert.equal(isCliEntryInvocation(moduleUrl, path.join(dir, "missing-link")), false);
  assert.equal(isCliEntryInvocation(moduleUrl, undefined), false);
});

test("scripts/quirks-campaign wrapper produces the same output as the dist CLI entry", async () => {
  const { root, stateDir } = await freshAcceptanceRepo();
  const wrapperPath = path.resolve("scripts/quirks-campaign");
  const distEntryPath = path.resolve("dist/src/cli/quirks-campaign.js");
  const env = { ...process.env, QUIRKS_STATE_DIR: stateDir };

  const viaWrapper = await execFileAsync(process.execPath, [wrapperPath, "resume-candidate", "--json"], {
    cwd: root,
    env,
  });
  const viaDist = await execFileAsync(process.execPath, [distEntryPath, "resume-candidate", "--json"], {
    cwd: root,
    env,
  });

  assert.notEqual(viaWrapper.stdout, "", "wrapper must run the CLI, not silently no-op");
  assert.deepEqual(JSON.parse(viaWrapper.stdout), { ok: true, available: false, reason: "no_resumable_campaign" });
  assert.equal(viaWrapper.stdout, viaDist.stdout);
  assert.equal(viaWrapper.stderr, viaDist.stderr);
});

async function captureCli(
  entryPath: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [entryPath, ...args], { cwd, env });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout: string; stderr: string; code: number };
    return { stdout: failure.stdout, stderr: failure.stderr, code: failure.code };
  }
}

test("scripts/quirks-campaign wrapper matches the dist CLI entry on parse errors", async () => {
  const { root, stateDir } = await freshAcceptanceRepo();
  const wrapperPath = path.resolve("scripts/quirks-campaign");
  const distEntryPath = path.resolve("dist/src/cli/quirks-campaign.js");
  const env = { ...process.env, QUIRKS_STATE_DIR: stateDir };

  const viaWrapper = await captureCli(wrapperPath, ["resume-candidate", "--bogus"], root, env);
  const viaDist = await captureCli(distEntryPath, ["resume-candidate", "--bogus"], root, env);

  assert.equal(viaDist.code, 2);
  assert.notEqual(viaDist.stderr, "");
  assert.equal(viaWrapper.code, viaDist.code, "wrapper must propagate the CLI exit code");
  assert.equal(viaWrapper.stdout, viaDist.stdout);
  assert.equal(viaWrapper.stderr, viaDist.stderr);
});

test("resume-candidate reports no_resumable_campaign for empty or terminal-only stores", async () => {
  const { root, stateDir } = await freshAcceptanceRepo();
  const previousStateDir = process.env.QUIRKS_STATE_DIR;
  process.env.QUIRKS_STATE_DIR = stateDir;
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    const empty = await runCampaignCommand({ command: "resume-candidate", json: true });
    assert.deepEqual(empty, { ok: true, available: false, reason: "no_resumable_campaign" });

    const context = await loadProjectContext(root, { mode: "inspection" });
    for (const [campaignId, status] of [
      ["cmp-complete", "complete"],
      ["cmp-cancelled", "cancelled"],
      ["cmp-hold", "hold"],
    ] as const) {
      await seedStoredCampaign({
        stateDir,
        repositoryId: context.repositoryId,
        campaignId,
        status,
        updatedAt: "2026-07-22T05:00:00.000Z",
      });
    }
    const terminalOnly = await runCampaignCommand({ command: "resume-candidate", json: true });
    assert.deepEqual(terminalOnly, { ok: true, available: false, reason: "no_resumable_campaign" });
  } finally {
    process.chdir(previousCwd);
    if (previousStateDir === undefined) delete process.env.QUIRKS_STATE_DIR;
    else process.env.QUIRKS_STATE_DIR = previousStateDir;
  }
});
