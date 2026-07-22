import assert from "node:assert/strict";
import test from "node:test";
import { CampaignCliParseError, parseCampaignArgs } from "../../src/cli/campaign-args.js";
import { runCampaignCommand } from "../../src/cli/campaign-commands.js";
import { execFile } from "node:child_process";
import { chmod, cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

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
    json: true,
  });
  assert.deepEqual(parseCampaignArgs(["cancel", "--campaign", "cmp-1", "--scope", "job-1"]), {
    command: "cancel",
    campaignId: "cmp-1",
    scope: "job-1",
    json: false,
  });
});

test("parseCampaignArgs rejects unknown commands and missing flags", () => {
  assert.throws(() => parseCampaignArgs([]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["explode"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["preflight"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["approve", "--campaign", "cmp-1"]), CampaignCliParseError);
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
      json: true,
    })) as { ok: boolean; dispatchedJobs: unknown[] };
    assert.equal(start.ok, true);
    assert.ok(start.dispatchedJobs.length >= 1);

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
