import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  MANAGING_AGENT_RESULT_SCHEMA,
  parseManagingAgentReport,
  quoteSupportedByTranscript,
} from "../../../src/runner/managing-agent/contract.js";

function fixture(name: string): Promise<string> {
  return readFile(path.resolve("test/fixtures/real-transcripts", name), "utf8");
}

/** A verbatim span of the reviewer's own recommendation in the revise fixture. */
const REVISE_QUOTE = "**Revise.** I don't think this should be accepted as it stands.";
/** A verbatim span of the accept fixture's recommendation. */
const ACCEPT_QUOTE = "**Accept as it stands.** I found nothing that must be fixed before this lands.";

function validReport(overrides: Record<string, unknown> = {}): unknown {
  return {
    status: "success",
    verdict: "revise",
    verdictEvidence: REVISE_QUOTE,
    findings: [
      { severity: "critical", title: "Off-by-one in the loop bound", detail: "index <= n sums n+1 elements", file: "sum.js", line: 3 },
    ],
    artifactPaths: ["/tmp/artifacts/notes.md"],
    sessionHandle: "session-1",
    failure: null,
    summary: "The reviewer reported two defects and asked for changes.",
    ...overrides,
  };
}

test("a verbatim quote from a real reviewer transcript is supported", async () => {
  const transcript = await fixture("claude-reviewer-revise.jsonl");
  assert.equal(quoteSupportedByTranscript(REVISE_QUOTE, transcript), true);
});

test("a verbatim accept quote is supported in the accept transcript", async () => {
  const transcript = await fixture("claude-reviewer-accept.jsonl");
  assert.equal(quoteSupportedByTranscript(ACCEPT_QUOTE, transcript), true);
});

test("a quote is supported across cursor's single-document transcript too", async () => {
  const transcript = await fixture("cursor-reviewer-revise.jsonl");
  assert.equal(
    quoteSupportedByTranscript("**Revise** `sum.js`: change the loop to `index < n`", transcript),
    true,
  );
});

test("a plausible paraphrase the reviewer never wrote is not supported", async () => {
  const transcript = await fixture("claude-reviewer-revise.jsonl");
  assert.equal(
    quoteSupportedByTranscript("I have reviewed this carefully and it looks good to me.", transcript),
    false,
  );
});

test("an accept quote is not supported by a transcript that never accepted", async () => {
  const transcript = await fixture("claude-no-judgment.jsonl");
  assert.equal(quoteSupportedByTranscript(ACCEPT_QUOTE, transcript), false);
});

// Measured, not imagined. A real sonnet interpretation of this exact fixture
// returned this exact string: the reviewer wrote "**Revise.**" with markdown
// emphasis and backticks around `NaN` and `sumFirstN(...)`, and the model
// quoted the words without the markup. The first version of this check called
// that unsupported and would have failed every correct verdict in production.
// The hand-written quotes above passed only because they were written with the
// asterisks already in them.
const REAL_INTERPRETATION_QUOTE =
  "Revise. I don't think this should be accepted as it stands. Defects 1 and 2 are not stylistic quibbles — " +
  "the function returns the wrong answer for every input and returns NaN for the most obvious call " +
  "(sumFirstN(arr, arr.length)), which means it fails on the path a caller is most likely to reach first.";

test("a quote that drops the transcript's markdown emphasis is still supported", async () => {
  const transcript = await fixture("claude-reviewer-revise.jsonl");
  assert.equal(quoteSupportedByTranscript(REAL_INTERPRETATION_QUOTE, transcript), true);
});

test("markup normalization does not admit words the reviewer never wrote", async () => {
  const transcript = await fixture("claude-reviewer-revise.jsonl");
  assert.equal(
    quoteSupportedByTranscript("**Accept.** I think this should be accepted as it stands.", transcript),
    false,
  );
});

test("re-wrapped whitespace does not break support, because line wrapping is not evidence", async () => {
  const transcript = await fixture("claude-reviewer-revise.jsonl");
  assert.equal(
    quoteSupportedByTranscript("**Revise.**    I don't think this should be\n accepted as it stands.", transcript),
    true,
  );
});

test("an empty or whitespace-only quote is never supported", () => {
  assert.equal(quoteSupportedByTranscript("", "anything"), false);
  assert.equal(quoteSupportedByTranscript("      ", "anything"), false);
});

test("a quote too short to identify anything is not supported", () => {
  // "ok" appears in almost any transcript. A fragment that short is not
  // evidence that a reviewer decided anything.
  assert.equal(quoteSupportedByTranscript("ok", "everything is ok here"), false);
});

test("the schema names every field the interpreter depends on and forbids extras", () => {
  const schema = MANAGING_AGENT_RESULT_SCHEMA as {
    required: readonly string[];
    additionalProperties: boolean;
    properties: Record<string, { enum?: readonly unknown[] }>;
  };
  assert.deepEqual([...schema.required].toSorted(), [
    "artifactPaths", "failure", "findings", "sessionHandle", "status", "summary", "verdict", "verdictEvidence",
  ]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties["verdict"]?.enum, ["accept", "revise", "indeterminate", null]);
});

test("a well-formed report parses into the exact reported values", () => {
  const report = parseManagingAgentReport(validReport());
  assert.equal(report?.verdict, "revise");
  assert.equal(report?.verdictEvidence, REVISE_QUOTE);
  assert.equal(report?.findings[0]?.severity, "critical");
  assert.equal(report?.findings[0]?.line, 3);
  assert.equal(report?.failure, null);
});

test("a report parses when the agent reports no verdict at all", () => {
  const report = parseManagingAgentReport(validReport({ verdict: null, verdictEvidence: "" }));
  assert.equal(report?.verdict, null);
});

test("a report with an unknown status is rejected rather than coerced", () => {
  assert.equal(parseManagingAgentReport(validReport({ status: "done" })), undefined);
});

test("a report with an invented verdict is rejected", () => {
  assert.equal(parseManagingAgentReport(validReport({ verdict: "looks-good" })), undefined);
  assert.equal(parseManagingAgentReport(validReport({ verdict: "ACCEPT" })), undefined);
});

test("a report missing a required field is rejected", () => {
  const { summary: _summary, ...withoutSummary } = validReport() as Record<string, unknown>;
  assert.equal(parseManagingAgentReport(withoutSummary), undefined);
});

test("a report whose findings are not objects is rejected", () => {
  assert.equal(parseManagingAgentReport(validReport({ findings: ["a critical bug"] })), undefined);
});

test("a report whose finding severity is invented is rejected", () => {
  assert.equal(
    parseManagingAgentReport(validReport({ findings: [{ severity: "blocker", title: "t", detail: "d" }] })),
    undefined,
  );
});

test("an over-long verdict quote is rejected, because the contract asks for a quote and not an essay", () => {
  assert.equal(parseManagingAgentReport(validReport({ verdictEvidence: "x".repeat(513) })), undefined);
});

test("a non-object report is rejected", () => {
  assert.equal(parseManagingAgentReport("accept"), undefined);
  assert.equal(parseManagingAgentReport(null), undefined);
  assert.equal(parseManagingAgentReport([validReport()]), undefined);
});

test("a failure with a missing code is rejected rather than half-read", () => {
  assert.equal(parseManagingAgentReport(validReport({ failure: { message: "it broke" } })), undefined);
});
