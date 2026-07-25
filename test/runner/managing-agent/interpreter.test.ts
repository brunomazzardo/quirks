import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MANAGING_AGENT_BRIEF_VERSION } from "../../../src/runner/managing-agent/brief.js";
import { DEFAULT_INTERPRETER_CONFIG, MANAGING_AGENT_MODEL } from "../../../src/runner/managing-agent/config.js";
import {
  ManagingAgentInterpreter,
  buildInterpreterArgv,
  type AgentSpawnResult,
} from "../../../src/runner/managing-agent/interpreter.js";
import type { RunnerJobFacts } from "../../../src/runner/interpretation.js";

const REVISE_QUOTE =
  "Revise. I don't think this should be accepted as it stands. Defects 1 and 2 are not stylistic quibbles";

function fixturePath(name: string): string {
  return path.resolve("test/fixtures/real-transcripts", name);
}

async function fixture(name: string): Promise<string> {
  return readFile(fixturePath(name), "utf8");
}

/**
 * The wire shape claude actually returns, measured on 2026-07-25: `-p
 * --output-format json` emits a JSON **array** of events, and the terminal
 * `result` event carries the validated object in `structured_output`.
 */
function agentStdout(structured: Record<string, unknown>, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([
    { type: "system", subtype: "init", session_id: "agent-session", tools: ["StructuredOutput"] },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      session_id: "agent-session",
      total_cost_usd: 0.0049,
      result: JSON.stringify(structured),
      structured_output: structured,
      ...overrides,
    },
  ]);
}

function report(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "success",
    verdict: "revise",
    verdictEvidence: REVISE_QUOTE,
    findings: [
      { severity: "critical", title: "Off-by-one in loop bound", detail: "sum.js:3 uses index <= n", file: "sum.js", line: 3 },
    ],
    artifactPaths: [],
    sessionHandle: "runner-session",
    failure: null,
    summary: "The reviewer found two defects and asked for changes.",
    ...overrides,
  };
}

async function scratchDirs(): Promise<{ artifactDir: string; worktreePath: string }> {
  return {
    artifactDir: await mkdtemp(path.join(os.tmpdir(), "quirks-interp-artifacts-")),
    worktreePath: await mkdtemp(path.join(os.tmpdir(), "quirks-interp-worktree-")),
  };
}

async function facts(
  overrides: Partial<RunnerJobFacts> = {},
): Promise<RunnerJobFacts> {
  const dirs = await scratchDirs();
  return {
    jobId: "cmp-1:QK-1:reviewer:1",
    role: "reviewer",
    runnerType: "claude",
    profileId: "personal-claude-opus-review",
    model: "opus",
    capabilities: ["repository-read"],
    exitCode: 0,
    artifactDir: dirs.artifactDir,
    worktreePath: dirs.worktreePath,
    transcriptPath: path.join(dirs.artifactDir, "transcript-job.jsonl"),
    sessionId: undefined,
    argv: ["claude", "-p"],
    // Far enough back that files written during the test count as this job's.
    startedAtMs: Date.now() - 1_000,
    ...overrides,
  };
}

interface Recorded {
  prompts: string[];
  calls: number;
}

function interpreterWith(
  responses: readonly (AgentSpawnResult | Error)[],
  recorded: Recorded = { prompts: [], calls: 0 },
): { interpreter: ManagingAgentInterpreter; recorded: Recorded } {
  const interpreter = new ManagingAgentInterpreter(DEFAULT_INTERPRETER_CONFIG, async (input) => {
    recorded.prompts.push(input.stdin);
    const response = responses[Math.min(recorded.calls, responses.length - 1)];
    recorded.calls += 1;
    if (response instanceof Error) throw response;
    return response!;
  });
  return { interpreter, recorded };
}

function ok(stdout: string): AgentSpawnResult {
  return { exitCode: 0, stdout, stderr: "" };
}

test("the interpreter is launched with no tools, no MCP, no settings, and no session persistence", () => {
  const argv = buildInterpreterArgv(DEFAULT_INTERPRETER_CONFIG, "SYSTEM BRIEF");
  assert.deepEqual(argv.slice(0, 2), ["claude", "-p"]);
  // Measured 2026-07-25: a default `claude -p` loads the operator's MCP
  // servers, plugins, and skills and costs $0.145 a call. With these flags the
  // tool list is exactly ["StructuredOutput"] and the same call costs $0.0049.
  assert.equal(argv[argv.indexOf("--tools") + 1], "");
  assert.ok(argv.includes("--strict-mcp-config"));
  assert.equal(argv[argv.indexOf("--mcp-config") + 1], '{"mcpServers":{}}');
  assert.ok(argv.includes("--disable-slash-commands"));
  assert.equal(argv[argv.indexOf("--setting-sources") + 1], "");
  assert.ok(argv.includes("--no-session-persistence"));
  assert.equal(argv[argv.indexOf("--model") + 1], MANAGING_AGENT_MODEL);
  assert.equal(argv[argv.indexOf("--output-format") + 1], "json");
  assert.equal(argv[argv.indexOf("--system-prompt") + 1], "SYSTEM BRIEF");
  assert.ok(argv.includes("--json-schema"));
});

test("the job prompt goes on stdin, never in argv where ps can read it", async () => {
  const { interpreter, recorded } = interpreterWith([ok(agentStdout(report()))]);
  const jobFacts = await facts();
  await interpreter.interpret(jobFacts, await fixture("claude-reviewer-revise.jsonl"));
  assert.match(recorded.prompts[0] ?? "", /BEGIN UNTRUSTED TRANSCRIPT/);
  assert.equal(buildInterpreterArgv(DEFAULT_INTERPRETER_CONFIG, "brief").some((entry) => entry.includes("UNTRUSTED")), false);
});

/**
 * Both wire shapes are real, measured against claude 2.1.220 on 2026-07-25:
 * with the production interpreter argv the CLI returns a JSON **array** of
 * events, while a plain `claude -p --output-format json` returns a **single
 * object**. Production accepts both; only the array was covered, so a later
 * tidy-up of that branch would have stayed green and broken every job.
 * Raised by the independent claude review.
 */
test("a single-object answer is read as readily as an array of events", async () => {
  const single = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: "agent-session",
    result: JSON.stringify(report()),
    structured_output: report(),
  });
  const { interpreter } = interpreterWith([ok(single)]);
  const result = await interpreter.interpret(await facts(), await fixture("claude-reviewer-revise.jsonl"));
  assert.equal(result.status, "success");
  assert.equal(result.verdict, "revise");
});

test("a reviewer verdict quoted from the real transcript survives interpretation", async () => {
  const { interpreter } = interpreterWith([ok(agentStdout(report()))]);
  const result = await interpreter.interpret(await facts(), await fixture("claude-reviewer-revise.jsonl"));
  assert.equal(result.status, "success");
  assert.equal(result.verdict, "revise");
  assert.equal(result.verdictEvidence, REVISE_QUOTE);
  assert.equal(result.findings?.[0]?.title, "Off-by-one in loop bound");
  assert.equal(result.findings?.[0]?.line, 3);
});

test("a verdict whose quote is absent from the transcript fails the job rather than accepting it", async () => {
  const fabricated = report({ verdict: "accept", verdictEvidence: "Looks great to me, shipping it as is." });
  const { interpreter, recorded } = interpreterWith([ok(agentStdout(fabricated))]);
  const result = await interpreter.interpret(await facts(), await fixture("claude-reviewer-revise.jsonl"));
  assert.equal(result.status, "failure");
  assert.equal(result.failure?.code, "unsupported_verdict");
  assert.notEqual(result.verdict, "accept");
  assert.equal(recorded.calls, 2, "an unsupported quote is retried once before the job fails");
});

test("the retry names what was wrong, so it is informed rather than a blind repeat", async () => {
  const fabricated = report({ verdict: "accept", verdictEvidence: "Looks great to me, shipping it as is." });
  const { interpreter, recorded } = interpreterWith([ok(agentStdout(fabricated))]);
  await interpreter.interpret(await facts(), await fixture("claude-reviewer-revise.jsonl"));
  assert.notEqual(recorded.prompts[0], recorded.prompts[1]);
  assert.match(recorded.prompts[1] ?? "", /Your previous answer was rejected/);
  assert.match(recorded.prompts[1] ?? "", /quote/i);
});

test("a retry that answers correctly is accepted, so one bad answer does not fail a good run", async () => {
  const fabricated = report({ verdict: "accept", verdictEvidence: "Looks great to me, shipping it as is." });
  const { interpreter } = interpreterWith([ok(agentStdout(fabricated)), ok(agentStdout(report()))]);
  const result = await interpreter.interpret(await facts(), await fixture("claude-reviewer-revise.jsonl"));
  assert.equal(result.status, "success");
  assert.equal(result.verdict, "revise");
});

test("a reviewer transcript with no judgment yields indeterminate, never accept", async () => {
  const none = report({ verdict: "indeterminate", verdictEvidence: "", findings: [] });
  const { interpreter } = interpreterWith([ok(agentStdout(none))]);
  const result = await interpreter.interpret(await facts(), await fixture("claude-no-judgment.jsonl"));
  assert.equal(result.status, "success");
  assert.equal(result.verdict, "indeterminate");
  assert.equal(result.verdictEvidence, undefined);
});

test("a reviewer job with a null verdict is recorded as indeterminate rather than silence", async () => {
  const none = report({ verdict: null, verdictEvidence: "" });
  const { interpreter } = interpreterWith([ok(agentStdout(none))]);
  const result = await interpreter.interpret(await facts(), await fixture("claude-no-judgment.jsonl"));
  assert.equal(result.verdict, "indeterminate");
});

test("an implementer job never carries a verdict, even when the agent supplies one", async () => {
  const { interpreter } = interpreterWith([ok(agentStdout(report({ verdict: "accept", verdictEvidence: REVISE_QUOTE })))]);
  const result = await interpreter.interpret(
    await facts({ role: "implementer" }),
    await fixture("claude-implementer-success.jsonl"),
  );
  assert.equal(result.verdict, undefined);
  assert.equal(result.verdictEvidence, undefined);
  assert.equal(result.status, "success");
});

test("a non-zero exit can never be reported as success", async () => {
  const { interpreter } = interpreterWith([ok(agentStdout(report({ verdict: "indeterminate", verdictEvidence: "" })))]);
  const result = await interpreter.interpret(await facts({ exitCode: 1 }), await fixture("claude-reviewer-revise.jsonl"));
  assert.equal(result.status, "failure");
  assert.ok(result.notes?.includes("exit_code_override"));
  assert.equal(result.failure?.code !== undefined, true);
});

test("a usage limit the runner reported is carried through as a usage limit", async () => {
  const limited = report({
    status: "usage_limit",
    verdict: "indeterminate",
    verdictEvidence: "",
    findings: [],
    failure: { code: "usage_limit", message: "You've hit your usage limit." },
  });
  const { interpreter } = interpreterWith([ok(agentStdout(limited))]);
  const result = await interpreter.interpret(
    await facts({ exitCode: 1 }),
    await fixture("codex-usage-limit.jsonl"),
  );
  // The exit-code guard must not flatten a classified failure into a generic one:
  // usage_limit drives the campaign's breaker and its retry-after-reset policy.
  assert.equal(result.status, "usage_limit");
  assert.equal(result.failure?.code, "usage_limit");
});

/**
 * Narrowing the haystack to runner-authored channels made an unknown
 * load-bearing: if a vendor's message shape is not one this reader knows, every
 * verdict over it fails the quote check. That must not look like the model
 * fabricating a quote, because the fault is ours and the fix is here — raised
 * by the independent claude review, 2026-07-25, about codex specifically, whose
 * real message shape is owed until its quota resets.
 */
test("a transcript whose author channel cannot be read says so, instead of blaming the model", async () => {
  const unknownShape = JSON.stringify({
    type: "unknown.event",
    payload: { note: "The reviewer said plenty here, in a shape we do not know." },
  });
  const { interpreter, recorded } = interpreterWith([ok(agentStdout(report({
    verdict: "revise",
    verdictEvidence: "The reviewer said plenty here, in a shape we do not know.",
  })))]);

  const result = await interpreter.interpret(await facts(), unknownShape);
  assert.equal(result.status, "failure");
  assert.equal(result.failure?.code, "unreadable_transcript_channel");
  assert.match(result.failure?.message ?? "", /transcript reader/);
  assert.equal(recorded.calls, 1, "retrying cannot help when the fault is ours");
  assert.notEqual(result.verdict, "revise");
});

test("a genuinely fabricated quote is still reported as fabrication, not as our gap", async () => {
  const { interpreter } = interpreterWith([ok(agentStdout(report({
    verdict: "accept",
    verdictEvidence: "Looks great to me, shipping it as is.",
  })))]);
  const result = await interpreter.interpret(await facts(), await fixture("claude-reviewer-revise.jsonl"));
  assert.equal(result.failure?.code, "unsupported_verdict");
});

test("interpretation is retried exactly once, then fails with the transcript kept", async () => {
  const { interpreter, recorded } = interpreterWith([new Error("api error: overloaded")]);
  const jobFacts = await facts();
  const result = await interpreter.interpret(jobFacts, await fixture("claude-reviewer-revise.jsonl"));
  assert.equal(recorded.calls, 2);
  assert.equal(result.status, "failure");
  assert.equal(result.failure?.code, "interpretation_failed");
  assert.match(result.failure?.message ?? "", /api error: overloaded/);
  assert.equal(result.verdict, undefined, "a failed interpretation never asserts a verdict");
});

test("an unparseable agent answer is retried and then fails honestly", async () => {
  const { interpreter, recorded } = interpreterWith([ok("not json at all")]);
  const result = await interpreter.interpret(await facts(), await fixture("claude-reviewer-revise.jsonl"));
  assert.equal(recorded.calls, 2);
  assert.equal(result.status, "failure");
  assert.equal(result.failure?.code, "interpretation_failed");
});

test("an agent answer that violates the schema is retried and then fails", async () => {
  const { interpreter, recorded } = interpreterWith([ok(agentStdout(report({ verdict: "looks-fine" })))]);
  const result = await interpreter.interpret(await facts(), await fixture("claude-reviewer-revise.jsonl"));
  assert.equal(recorded.calls, 2);
  assert.equal(result.failure?.code, "interpretation_failed");
});

test("the interpretation record is retained and names the evidence it rests on", async () => {
  const { interpreter } = interpreterWith([ok(agentStdout(report()))]);
  const jobFacts = await facts();
  const result = await interpreter.interpret(jobFacts, await fixture("claude-reviewer-revise.jsonl"));

  assert.equal(typeof result.interpretationPath, "string");
  assert.ok(result.artifactPaths.includes(result.interpretationPath!));
  const record = JSON.parse(await readFile(result.interpretationPath!, "utf8")) as {
    report: { verdict: string };
    transcriptPath: string;
    briefVersion: number;
    interpreterModel: string;
    checks: { quoteSupported: boolean; attempts: number };
  };
  assert.equal(record.report.verdict, "revise");
  assert.equal(record.transcriptPath, jobFacts.transcriptPath);
  assert.equal(record.briefVersion, MANAGING_AGENT_BRIEF_VERSION);
  assert.equal(record.interpreterModel, MANAGING_AGENT_MODEL);
  assert.equal(record.checks.quoteSupported, true);
  assert.equal(record.checks.attempts, 1);
});

test("the record carries what the interpretation cost, so the cheap-tier claim stays measured", async () => {
  const { interpreter } = interpreterWith([ok(agentStdout(report()))]);
  const result = await interpreter.interpret(await facts(), await fixture("claude-reviewer-revise.jsonl"));
  const record = JSON.parse(await readFile(result.interpretationPath!, "utf8")) as { interpreterCostUsd: number };
  assert.equal(record.interpreterCostUsd, 0.0049);
});

test("a failed interpretation still retains its record, so the failure is auditable too", async () => {
  const { interpreter } = interpreterWith([ok("not json at all")]);
  const result = await interpreter.interpret(await facts(), await fixture("claude-reviewer-revise.jsonl"));
  assert.equal(typeof result.interpretationPath, "string");
  const record = JSON.parse(await readFile(result.interpretationPath!, "utf8")) as { checks: { attempts: number } };
  assert.equal(record.checks.attempts, 2);
});

test("artifact paths the agent invented are dropped and real ones are kept", async () => {
  const jobFacts = await facts();
  const realFile = path.join(jobFacts.artifactDir, "findings.md");
  await writeFile(realFile, "# findings\n", "utf8");
  const claimed = report({ artifactPaths: [realFile, "/nonexistent/made-up.json", "/etc/passwd"] });
  const { interpreter } = interpreterWith([ok(agentStdout(claimed))]);

  const result = await interpreter.interpret(jobFacts, await fixture("claude-reviewer-revise.jsonl"));
  assert.ok(result.artifactPaths.includes(realFile));
  assert.equal(result.artifactPaths.includes("/nonexistent/made-up.json"), false);
  // A path outside the job's own directories is not this job's evidence, even
  // when it exists.
  assert.equal(result.artifactPaths.includes("/etc/passwd"), false);
});

test("the session handle is read from the transcript, not taken from the agent's word for it", async () => {
  const { interpreter } = interpreterWith([ok(agentStdout(report({ sessionHandle: "invented-handle" })))]);
  const result = await interpreter.interpret(await facts(), await fixture("claude-reviewer-revise.jsonl"));
  assert.notEqual(result.sessionHandle, "invented-handle");
  assert.match(result.sessionHandle, /^[0-9a-f-]{36}$/);
});

test("an agent that exits non-zero is a failed interpretation, not a failed job verdict", async () => {
  const { interpreter } = interpreterWith([{ exitCode: 1, stdout: "", stderr: "claude: command failed" }]);
  const result = await interpreter.interpret(await facts(), await fixture("claude-reviewer-revise.jsonl"));
  assert.equal(result.status, "failure");
  assert.equal(result.failure?.code, "interpretation_failed");
  assert.match(result.failure?.message ?? "", /command failed/);
});
