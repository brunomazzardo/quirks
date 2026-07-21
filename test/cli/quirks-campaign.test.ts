import assert from "node:assert/strict";
import test from "node:test";
import { CampaignCliParseError, parseCampaignArgs } from "../../src/cli/campaign-args.js";
import { runCampaignCommand } from "../../src/cli/campaign-commands.js";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  const stateDir = path.join(root, ".quirks-state");
  const fixture = path.resolve("test/fixtures/campaign-project");
  await cp(fixture, root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Quirks Test"]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "fixture"]);
  return { root, stateDir };
}

test("runCampaignCommand preflight approve start status flow uses fake runner", async () => {
  const { root, stateDir } = await freshAcceptanceRepo();
  const previousStateDir = process.env.QUIRKS_STATE_DIR;
  const previousFakeRunner = process.env.QUIRKS_USE_FAKE_RUNNER;
  process.env.QUIRKS_STATE_DIR = stateDir;
  process.env.QUIRKS_USE_FAKE_RUNNER = "1";
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
    const cleanAfterDesign = (await runCampaignCommand({
      command: "preflight",
      taskIds: ["QK-200"],
      externalRouting: false,
      json: true,
    })) as { ok: boolean; campaignId: string; envelope: { digest: string } };
    assert.equal(cleanAfterDesign.ok, true);

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
    if (previousFakeRunner === undefined) delete process.env.QUIRKS_USE_FAKE_RUNNER;
    else process.env.QUIRKS_USE_FAKE_RUNNER = previousFakeRunner;
  }
});
