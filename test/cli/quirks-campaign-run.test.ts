import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { hasDurableApproval } from "../../src/campaign/approval.js";
import { CampaignStore } from "../../src/campaign/store.js";
import { CampaignCliParseError, parseCampaignArgs, type ParsedCampaignArgs } from "../../src/cli/campaign-args.js";
import {
  createEventTailState,
  pollEventTail,
  runCampaignRun,
  TORN_TAIL_TICK_LIMIT,
  type CampaignRunIo,
} from "../../src/cli/campaign-run.js";
import { runCampaignCommand, stateDirFor } from "../../src/cli/campaign-commands.js";
import { loadProjectContext } from "../../src/project/config.js";
import { createDurableApprovalWritePort } from "../../src/ui/open-workspace.js";

const execFileAsync = promisify(execFile);

type ParsedRun = Extract<ParsedCampaignArgs, { command: "run" }>;

test("parseCampaignArgs accepts the documented run shapes", () => {
  assert.deepEqual(parseCampaignArgs(["run", "--task", "QK-1"]), {
    command: "run",
    taskIds: ["QK-1"],
    externalRouting: false,
    approval: "inline",
    json: false,
  });
  assert.deepEqual(
    parseCampaignArgs([
      "run",
      "--task", "QK-1",
      "--task", "QK-2",
      "--campaign", "cmp-retry-1",
      "--external-routing",
      "--max-concurrency", "3",
      "--browser",
      "--json",
    ]),
    {
      command: "run",
      taskIds: ["QK-1", "QK-2"],
      campaignId: "cmp-retry-1",
      externalRouting: true,
      maxConcurrency: 3,
      approval: "browser",
      json: true,
    },
  );
  assert.deepEqual(parseCampaignArgs(["run", "--task", "QK-1", "--inline"]), {
    command: "run",
    taskIds: ["QK-1"],
    externalRouting: false,
    approval: "inline",
    json: false,
  });
});

test("parseCampaignArgs rejects malformed run invocations", () => {
  assert.throws(() => parseCampaignArgs(["run"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["run", "--task", "QK-1", "--browser", "--inline"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["run", "--task", "QK-1", "--browser", "--browser"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["run", "--task", "QK-1", "--inline", "--inline"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["run", "--task", "QK-1", "--max-concurrency", "0"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["run", "--task", "QK-1", "--campaign", "cmp:colon"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["run", "--task", "QK-1", "--bogus"]), CampaignCliParseError);
  assert.throws(() => parseCampaignArgs(["run", "extra"]), CampaignCliParseError);
});

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
  // The managing agent is configured the way an operator configures it and
  // points at a fake agent binary: a campaign test must exercise the real
  // interpretation path without spending a real model call on it.
  const interpreterExecutable = await executableFakeRunner("fake-interpreter.mjs", configDir);
  await writeFile(
    path.join(configDir, "profiles.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      interpreter: { executable: interpreterExecutable, wallClockMs: 10_000 },
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

async function freshAcceptanceRepo(): Promise<{ root: string; stateDir: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-run-"));
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-run-state-"));
  const fixture = path.resolve("test/fixtures/campaign-project");
  await cp(fixture, root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Quirks Test"]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "fixture"]);
  return { root, stateDir };
}

interface RunHarness {
  root: string;
  stateDir: string;
  restore: () => void;
}

async function openRunHarness(options: { withRunnerConfig: boolean }): Promise<RunHarness> {
  const { root, stateDir } = await freshAcceptanceRepo();
  const previousStateDir = process.env.QUIRKS_STATE_DIR;
  const previousConfigDir = process.env.QUIRKS_CONFIG_DIR;
  const previousCwd = process.cwd();
  process.env.QUIRKS_STATE_DIR = stateDir;
  if (options.withRunnerConfig) {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "quirks-run-config-"));
    await writeCampaignRunnerConfig(configDir);
    process.env.QUIRKS_CONFIG_DIR = configDir;
  }
  process.chdir(root);
  return {
    root,
    stateDir,
    restore: () => {
      process.chdir(previousCwd);
      if (previousStateDir === undefined) delete process.env.QUIRKS_STATE_DIR;
      else process.env.QUIRKS_STATE_DIR = previousStateDir;
      if (previousConfigDir === undefined) delete process.env.QUIRKS_CONFIG_DIR;
      else process.env.QUIRKS_CONFIG_DIR = previousConfigDir;
    },
  };
}

interface CapturedIo {
  io: CampaignRunIo;
  out: string[];
  err: string[];
  prompts: string[];
  browserUrls: string[];
}

function capturedIo(options: {
  isTty: boolean;
  answers?: string[];
  onOpenBrowser?: (url: string) => Promise<void>;
} = { isTty: true }): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  const prompts: string[] = [];
  const browserUrls: string[] = [];
  const answers = [...(options.answers ?? [])];
  const io: CampaignRunIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    isTty: options.isTty,
    question: async (prompt) => {
      prompts.push(prompt);
      const answer = answers.shift();
      if (answer === undefined) throw new Error("Unexpected extra prompt");
      return answer;
    },
    openBrowser: async (url) => {
      browserUrls.push(url);
      await options.onOpenBrowser?.(url);
    },
    pollIntervalMs: 25,
  };
  return { io, out, err, prompts, browserUrls };
}

async function openStore(root: string, stateDir: string, campaignId: string): Promise<CampaignStore> {
  const context = await loadProjectContext(root, { mode: "inspection" });
  return CampaignStore.open(stateDir, context.repositoryId, campaignId);
}

function findCampaignId(lines: readonly string[]): string {
  for (const line of lines) {
    const match = line.match(/Campaign (\S+)/);
    if (match) return match[1]!;
  }
  throw new Error(`No campaign id found in transcript:\n${lines.join("\n")}`);
}

test("run drives preflight, one y/N decision, durable approval, and completion in one command", async () => {
  const harness = await openRunHarness({ withRunnerConfig: true });
  try {
    const parsed: ParsedRun = {
      command: "run",
      taskIds: ["QK-101"],
      externalRouting: true,
      approval: "inline",
      json: false,
    };
    const captured = capturedIo({ isTty: true, answers: ["y"] });
    const code = await runCampaignRun(parsed, captured.io);
    assert.equal(code, 0, `expected success, transcript:\n${captured.out.join("\n")}\n${captured.err.join("\n")}`);

    const campaignId = findCampaignId(captured.out);
    const store = await openStore(harness.root, harness.stateDir, campaignId);
    const envelope = await store.readEnvelope();

    // ONE decision: exactly one prompt, and it names the digest it approves.
    assert.equal(captured.prompts.length, 1);
    assert.ok(captured.prompts[0]!.includes(campaignId), "prompt must name the campaign");
    assert.ok(captured.prompts[0]!.includes(envelope.digest), "prompt must show the digest it approves");
    assert.match(captured.prompts[0]!, /\[y\/N\]/);

    // The approval is durable and recorded through the real approval path.
    assert.equal(await hasDurableApproval(store, envelope.digest), true);
    const approvals = await store.readApprovals();
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0]!.digest, envelope.digest);

    const transcript = captured.out.join("\n");
    // Envelope summary is compact and honest: digest, route profile ids, budgets.
    assert.ok(transcript.includes(`envelope digest: ${envelope.digest}`), transcript);
    assert.ok(transcript.includes("codex-standard"), "summary must include route profile ids");
    assert.ok(transcript.includes("claude-principal"), "summary must include reviewer profile ids");
    assert.match(transcript, /budgets: /);
    // Status transitions stream as human-readable lines.
    assert.match(transcript, /wave 0 started: QK-101/);
    assert.match(transcript, /job dispatched: .*QK-101:implementer:1 \(profile codex-standard\)/);
    assert.match(transcript, /wave 0 completed: QK-101/);
    // Outcome summary with the next command.
    assert.match(transcript, /Outcome: completed/);
    assert.ok(
      transcript.includes(`Next: quirks-campaign status --campaign ${campaignId}`),
      "completed outcome must print the next command",
    );
  } finally {
    harness.restore();
  }
});

test("run --json without a TTY refuses fail-closed with the stored-digest approve command", async () => {
  const harness = await openRunHarness({ withRunnerConfig: true });
  try {
    const parsed: ParsedRun = {
      command: "run",
      taskIds: ["QK-101"],
      externalRouting: true,
      approval: "inline",
      json: true,
    };
    const captured = capturedIo({ isTty: false });
    const code = await runCampaignRun(parsed, captured.io);
    assert.equal(code, 3, "refusal must be fail-closed with a non-zero domain exit code");
    assert.equal(captured.prompts.length, 0, "no interactive prompt may be attempted");
    assert.equal(captured.out.length, 1, "json mode emits exactly one payload");

    const payload = JSON.parse(captured.out[0]!) as {
      ok: boolean;
      reason: string;
      campaignId: string;
      digest: string;
      approveCommand: string;
      startCommand: string;
      localCoordinationOnly: boolean;
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.reason, "interactive_approval_required");
    assert.equal(payload.localCoordinationOnly, true);

    // The printed approve command must carry the STORED digest, read back from
    // the campaign store, so it is executable verbatim.
    const store = await openStore(harness.root, harness.stateDir, payload.campaignId);
    const envelope = await store.readEnvelope();
    assert.equal(payload.digest, envelope.digest);
    assert.equal(
      payload.approveCommand,
      `quirks-campaign approve --campaign ${payload.campaignId} --digest ${envelope.digest}`,
    );
    assert.equal(payload.startCommand, `quirks-campaign start --campaign ${payload.campaignId}`);

    // Fail-closed: nothing was approved or dispatched.
    assert.equal(await hasDurableApproval(store, envelope.digest), false);
    assert.equal((await store.readState()).status, "awaiting_approval");
  } finally {
    harness.restore();
  }
});

test("run surfaces preflight blockers immediately with remediation and stages nothing", async () => {
  const harness = await openRunHarness({ withRunnerConfig: false });
  try {
    const parsed: ParsedRun = {
      command: "run",
      taskIds: ["QK-200"],
      externalRouting: false,
      approval: "inline",
      json: false,
    };
    const captured = capturedIo({ isTty: true });
    const code = await runCampaignRun(parsed, captured.io);
    assert.equal(code, 3);
    assert.equal(captured.prompts.length, 0, "blocked preflight must never reach the approval decision");

    const transcript = [...captured.out, ...captured.err].join("\n");
    assert.ok(
      transcript.includes("QK-100 is a required design dependency"),
      `blocker text must be surfaced, transcript:\n${transcript}`,
    );
    assert.ok(transcript.includes("Nothing was staged or approved"), transcript);
    assert.ok(
      transcript.includes("quirks-campaign run --task QK-200"),
      "remediation must include the exact re-run command",
    );
  } finally {
    harness.restore();
  }
});

test("run declining the decision leaves the campaign awaiting approval with exact next commands", async () => {
  const harness = await openRunHarness({ withRunnerConfig: true });
  try {
    const parsed: ParsedRun = {
      command: "run",
      taskIds: ["QK-101"],
      externalRouting: true,
      approval: "inline",
      json: false,
    };
    const captured = capturedIo({ isTty: true, answers: ["n"] });
    const code = await runCampaignRun(parsed, captured.io);
    assert.equal(code, 3);

    const campaignId = findCampaignId(captured.out);
    const store = await openStore(harness.root, harness.stateDir, campaignId);
    const envelope = await store.readEnvelope();
    assert.equal(await hasDurableApproval(store, envelope.digest), false);
    assert.equal((await store.readState()).status, "awaiting_approval");

    const transcript = [...captured.out, ...captured.err].join("\n");
    assert.ok(
      transcript.includes(`quirks-campaign approve --campaign ${campaignId} --digest ${envelope.digest}`),
      "decline must print the exact approve command with the stored digest",
    );
  } finally {
    harness.restore();
  }
});

test("run re-stages a stale pre-approval envelope automatically after a config fix", async () => {
  const harness = await openRunHarness({ withRunnerConfig: true });
  try {
    // First attempt with placeholder routing: staged, then declined.
    const configDir = process.env.QUIRKS_CONFIG_DIR;
    delete process.env.QUIRKS_CONFIG_DIR;
    const first = capturedIo({ isTty: true, answers: ["n"] });
    const firstCode = await runCampaignRun(
      { command: "run", taskIds: ["QK-101"], externalRouting: false, approval: "inline", json: false },
      first.io,
    );
    process.env.QUIRKS_CONFIG_DIR = configDir;
    assert.equal(firstCode, 3);
    const campaignId = findCampaignId(first.out);
    const store = await openStore(harness.root, harness.stateDir, campaignId);
    const staleDigest = (await store.readEnvelope()).digest;

    // Operator fixes routing config and re-runs the same command: the stale
    // pre-approval envelope is replaced automatically, no state-dir surgery.
    const second = capturedIo({ isTty: true, answers: ["y"] });
    const secondCode = await runCampaignRun(
      { command: "run", taskIds: ["QK-101"], externalRouting: true, approval: "inline", json: false },
      second.io,
    );
    assert.equal(secondCode, 0, `transcript:\n${second.out.join("\n")}\n${second.err.join("\n")}`);
    assert.ok(second.out.some((line) => line.includes(`Campaign ${campaignId} staged (replaced)`)));

    const freshDigest = (await store.readEnvelope()).digest;
    assert.notEqual(freshDigest, staleDigest);
    assert.ok(second.prompts[0]!.includes(freshDigest), "the decision binds the fresh stored digest");
    // The approval binds only the fresh digest; the stale one stays unapproved.
    assert.equal(await hasDurableApproval(store, freshDigest), true);
    assert.equal(await hasDurableApproval(store, staleDigest), false);
    assert.match(second.out.join("\n"), /Outcome: completed/);
  } finally {
    harness.restore();
  }
});

test("a mid-prompt re-stage refusal coaches re-running run, never a blind approve of an unseen envelope", async () => {
  const harness = await openRunHarness({ withRunnerConfig: true });
  try {
    const parsed: ParsedRun = {
      command: "run",
      taskIds: ["QK-101"],
      externalRouting: true,
      approval: "inline",
      json: false,
    };
    const captured = capturedIo({ isTty: true });
    // While the operator stares at the prompt, a concurrent preflight
    // re-stages the same campaign with different routing: the stored digest
    // changes underneath the pending decision.
    captured.io.question = async (prompt) => {
      captured.prompts.push(prompt);
      const restaged = (await runCampaignCommand({
        command: "preflight",
        taskIds: ["QK-101"],
        externalRouting: false,
        json: true,
      })) as { ok: boolean; staging?: string };
      assert.equal(restaged.ok, true);
      assert.equal(restaged.staging, "replaced");
      return "y";
    };
    const code = await runCampaignRun(parsed, captured.io);
    assert.equal(code, 3);

    const campaignId = findCampaignId(captured.out);
    const store = await openStore(harness.root, harness.stateDir, campaignId);
    // The approval model refused: nothing was recorded against either digest.
    assert.equal((await store.readApprovals()).length, 0);

    const transcript = [...captured.out, ...captured.err].join("\n");
    assert.match(transcript, /DIGEST_MISMATCH/);
    // The honest recovery re-runs `run`, which re-prints the summary of the
    // changed envelope and re-asks the one decision.
    assert.ok(
      transcript.includes(
        `Recovery: quirks-campaign run --task QK-101 --campaign ${campaignId} --external-routing`,
      ),
      `recovery must re-run run, transcript:\n${transcript}`,
    );
    // Never coach a durable approve of an envelope whose summary the operator
    // has not seen.
    assert.ok(
      !transcript.includes("quirks-campaign approve"),
      `must not coach a blind approve, transcript:\n${transcript}`,
    );
  } finally {
    harness.restore();
  }
});

test("run --browser waits for the durable browser approval and then completes", async () => {
  const harness = await openRunHarness({ withRunnerConfig: true });
  try {
    const parsed: ParsedRun = {
      command: "run",
      taskIds: ["QK-101"],
      externalRouting: true,
      approval: "browser",
      json: false,
    };
    // The fake browser approves through the loopback workspace's own durable
    // approval port - the identical code path the UI approval POST uses.
    const captured = capturedIo({
      isTty: true,
      onOpenBrowser: async () => {
        const context = await loadProjectContext(harness.root, { mode: "inspection" });
        const store = await CampaignStore.open(harness.stateDir, context.repositoryId, findCampaignId(captured.out));
        const envelope = await store.readEnvelope();
        const port = createDurableApprovalWritePort(harness.stateDir);
        const issued = await port.issueToken({
          campaignId: envelope.campaignId,
          envelopeDigest: envelope.digest,
        });
        const outcome = await port.approve({
          campaignId: envelope.campaignId,
          envelopeDigest: envelope.digest,
          approvalToken: issued.approvalToken,
          operator: { label: "local-ui", evidence: "loopback-session" },
        });
        assert.equal(outcome.result, "approved");
      },
    });
    captured.io.browserApprovalTimeoutMs = 5_000;
    const code = await runCampaignRun(parsed, captured.io);
    assert.equal(code, 0, `transcript:\n${captured.out.join("\n")}\n${captured.err.join("\n")}`);
    assert.equal(captured.prompts.length, 0, "browser mode never prompts on the TTY");
    assert.equal(captured.browserUrls.length, 1, "the workspace must be opened exactly once");
    assert.match(captured.browserUrls[0]!, /approvalToken=/);

    const campaignId = findCampaignId(captured.out);
    const store = await openStore(harness.root, harness.stateDir, campaignId);
    const envelope = await store.readEnvelope();
    assert.equal(await hasDurableApproval(store, envelope.digest), true);
    assert.match(captured.out.join("\n"), /Outcome: completed/);
  } finally {
    harness.restore();
  }
});

test("run --browser times out fail-closed with the stored-digest approve command", async () => {
  const harness = await openRunHarness({ withRunnerConfig: true });
  try {
    const parsed: ParsedRun = {
      command: "run",
      taskIds: ["QK-101"],
      externalRouting: true,
      approval: "browser",
      json: false,
    };
    const captured = capturedIo({ isTty: true });
    captured.io.browserApprovalTimeoutMs = 100;
    const code = await runCampaignRun(parsed, captured.io);
    assert.equal(code, 3);

    const campaignId = findCampaignId(captured.out);
    const store = await openStore(harness.root, harness.stateDir, campaignId);
    const envelope = await store.readEnvelope();
    assert.equal(await hasDurableApproval(store, envelope.digest), false);
    const transcript = [...captured.out, ...captured.err].join("\n");
    assert.ok(
      transcript.includes(`quirks-campaign approve --campaign ${campaignId} --digest ${envelope.digest}`),
      "timeout must print the exact approve command with the stored digest",
    );
  } finally {
    harness.restore();
  }
});

test("the dist CLI entry wires run to the fail-closed json refusal", async () => {
  const { root, stateDir } = await freshAcceptanceRepo();
  const distEntryPath = path.resolve("dist/src/cli/quirks-campaign.js");
  const env: NodeJS.ProcessEnv = { ...process.env, QUIRKS_STATE_DIR: stateDir };
  delete env.QUIRKS_CONFIG_DIR;

  let stdout: string;
  let code: number;
  try {
    const result = await execFileAsync(
      process.execPath,
      [distEntryPath, "run", "--task", "QK-101", "--json"],
      { cwd: root, env },
    );
    stdout = result.stdout;
    code = 0;
  } catch (error) {
    const failure = error as { stdout: string; code: number };
    stdout = failure.stdout;
    code = failure.code;
  }
  assert.equal(code, 3, `expected fail-closed refusal, stdout: ${stdout}`);
  const payload = JSON.parse(stdout) as { ok: boolean; reason: string; approveCommand: string; digest: string };
  assert.equal(payload.ok, false);
  assert.equal(payload.reason, "interactive_approval_required");
  assert.ok(payload.approveCommand.includes(payload.digest));
});

function journalFrame(id: string, type: string, evidence: Record<string, string>): string {
  return JSON.stringify({
    schemaVersion: 1,
    id,
    type,
    at: "2026-07-23T00:00:00.000Z",
    actor: "supervisor",
    from: "running",
    to: "running",
    reason: type.replaceAll(".", "_"),
    evidence,
  });
}

test("pollEventTail tolerates a torn tail line and resumes once the frame completes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-journal-"));
  const eventsFile = path.join(dir, "events.jsonl");
  const frame1 = journalFrame("w0s", "wave.started", { wave: "0", taskIds: "QK-1" });
  const frame2 = journalFrame("d1", "runner.dispatched", { jobId: "cmp:QK-1:implementer:1", profileId: "codex-standard" });
  const frame3 = journalFrame("w0c", "wave.completed", { wave: "0", completedTaskIds: "QK-1" });

  // A writer was interrupted mid-frame: the tail line is torn.
  await writeFile(eventsFile, `${frame1}\n${frame2}\n{"schemaVersion":1,"id":"tor`, "utf8");
  const state = createEventTailState(0);
  const torn = await pollEventTail(eventsFile, state);
  assert.equal(torn.warning, undefined, "a torn tail is tolerated, not surfaced");
  assert.deepEqual(torn.lines, [
    "wave 0 started: QK-1",
    "job dispatched: cmp:QK-1:implementer:1 (profile codex-standard)",
  ]);

  // The writer finishes the frame: the next poll streams it and recovers.
  await writeFile(eventsFile, `${frame1}\n${frame2}\n${frame3}\n`, "utf8");
  const recovered = await pollEventTail(eventsFile, state);
  assert.equal(recovered.warning, undefined);
  assert.deepEqual(recovered.lines, ["wave 0 completed: QK-1"]);

  // Nothing new: quiet poll.
  const quiet = await pollEventTail(eventsFile, state);
  assert.deepEqual(quiet, { lines: [] });
});

test("pollEventTail surfaces a warning only when the same frame stays unparseable across ticks", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-journal-"));
  const eventsFile = path.join(dir, "events.jsonl");
  const frame1 = journalFrame("w0s", "wave.started", { wave: "0", taskIds: "QK-1" });
  await writeFile(eventsFile, `${frame1}\nnot-json-at-all\n`, "utf8");

  const state = createEventTailState(0);
  const first = await pollEventTail(eventsFile, state);
  assert.deepEqual(first.lines, ["wave 0 started: QK-1"]);
  assert.equal(first.warning, undefined);

  let warning: string | undefined;
  for (let tick = 2; tick <= TORN_TAIL_TICK_LIMIT; tick += 1) {
    const poll = await pollEventTail(eventsFile, state);
    assert.deepEqual(poll.lines, []);
    warning = poll.warning;
    if (tick < TORN_TAIL_TICK_LIMIT) assert.equal(warning, undefined, `no warning before tick ${TORN_TAIL_TICK_LIMIT}`);
  }
  assert.ok(warning, "the persistent unparseable frame must be surfaced");
  assert.match(warning, /unparseable/);

  // Once surfaced, streaming stays disabled instead of repeating the warning.
  assert.deepEqual(await pollEventTail(eventsFile, state), { lines: [] });
});

test("pollEventTail surfaces a shrinking journal instead of re-streaming stale frames", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-journal-"));
  const eventsFile = path.join(dir, "events.jsonl");
  const frame1 = journalFrame("w0s", "wave.started", { wave: "0", taskIds: "QK-1" });
  const frame2 = journalFrame("w0c", "wave.completed", { wave: "0", completedTaskIds: "QK-1" });
  await writeFile(eventsFile, `${frame1}\n${frame2}\n`, "utf8");

  const state = createEventTailState(0);
  const streamed = await pollEventTail(eventsFile, state);
  assert.equal(streamed.lines.length, 2);

  await writeFile(eventsFile, `${frame1}\n`, "utf8");
  const shrunk = await pollEventTail(eventsFile, state);
  assert.deepEqual(shrunk.lines, []);
  assert.ok(shrunk.warning, "a shrinking journal must be surfaced");
  assert.match(shrunk.warning, /shrank/);
});

test("stateDirFor honors QUIRKS_STATE_DIR for the run composition", () => {
  const previous = process.env.QUIRKS_STATE_DIR;
  process.env.QUIRKS_STATE_DIR = "/tmp/quirks-run-state-dir-test";
  try {
    assert.equal(stateDirFor("repo:any"), "/tmp/quirks-run-state-dir-test");
  } finally {
    if (previous === undefined) delete process.env.QUIRKS_STATE_DIR;
    else process.env.QUIRKS_STATE_DIR = previous;
  }
});
