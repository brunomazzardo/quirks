import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { computeEnvelopeDigest, stripDigest } from "../../src/campaign/envelope.js";
import { createCampaignRuntime } from "../../src/campaign/runtime-context.js";
import type { CampaignEnvelope } from "../../src/campaign/types.js";
import { campaignEnvelope } from "./support.js";

const execFileAsync = promisify(execFile);

async function freshGitRepo(): Promise<{ root: string; head: string; stateDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-runtime-repo-"));
  const stateDir = path.join(root, ".quirks-state");
  await writeFile(path.join(root, "README.md"), "# runtime fixture\n", "utf8");
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "runtime@quirks.test"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Runtime Fixture"]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "fixture"]);
  const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"]);
  return { root, head: stdout.trim(), stateDir };
}

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

async function writeProfilesConfig(configDir: string, executable: string): Promise<void> {
  await mkdir(configDir, { recursive: true });
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
          profileId: "claude-principal",
          runnerType: "claude",
          executable,
          accountAlias: "work",
          quotaPoolId: "pool-claude",
          tier: "principal",
          model: "fable-principal",
          effort: "principal",
          capabilities: ["repository-read", "repository-write"],
          wallClockMs: 3_600_000,
          redactionRules: [],
        },
        {
          schemaVersion: 1,
          profileId: "codex-standard",
          runnerType: "codex",
          executable,
          accountAlias: "work",
          quotaPoolId: "pool-codex",
          tier: "standard",
          model: "composer-standard",
          effort: "standard",
          capabilities: ["repository-read"],
          wallClockMs: 1_800_000,
          redactionRules: [],
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
}

function approvedEnvelope(head: string, routing: CampaignEnvelope["routing"]): CampaignEnvelope {
  const incomplete = campaignEnvelope({
    git: {
      baseCommit: head,
      campaignBranch: "quirks/cmp-runtime/integration",
      targetBranch: "main",
      push: { enabled: false },
    },
    routing,
    externalRoutingEnabled: true,
  });
  return { ...incomplete, digest: computeEnvelopeDigest(stripDigest(incomplete)) };
}

test("real runtime loads envelope-approved profiles and Git worktrees", async () => {
  const { root, head, stateDir } = await freshGitRepo();
  const configDir = await mkdtemp(path.join(os.tmpdir(), "quirks-runtime-config-"));
  const executable = await executableFakeRunner("fake-claude.mjs", configDir);
  await writeProfilesConfig(configDir, executable);

  const envelope = approvedEnvelope(head, {
    "QK-101": {
      primary: { profileId: "codex-standard", tier: "standard", effort: "standard" },
      fallbacks: [{ profileId: "claude-principal", tier: "principal", effort: "principal" }],
    },
  });

  const runtime = await createCampaignRuntime(envelope, root, { mode: "real", configDir, stateDir });
  assert.equal(runtime.runner.constructor.name, "CliRunnerPort");
  assert.equal(runtime.worktree.constructor.name, "GitWorktreeManager");
});

test("real runtime fails closed when user profiles are missing", async () => {
  const { root, head } = await freshGitRepo();
  const missing = path.join(await mkdtemp(path.join(os.tmpdir(), "quirks-missing-config-")), "absent");
  const envelope = approvedEnvelope(head, {
    "QK-101": {
      primary: { profileId: "codex-standard", tier: "standard", effort: "standard" },
      fallbacks: [],
    },
  });

  await assert.rejects(
    () => createCampaignRuntime(envelope, root, { mode: "real", configDir: missing }),
    /Missing user configuration file profiles.json/,
  );
});
