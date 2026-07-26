import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  MANAGING_AGENT_RESULT_SCHEMA,
  parseManagingAgentReport,
  quoteSupportedByTranscript,
} from "../../../src/runner/managing-agent/contract.js";
import { transcriptAllText } from "../../../src/runner/transcript.js";

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

/**
 * Raised as a Critical by the independent cursor review, 2026-07-25, and
 * confirmed by measurement: the reviewer's brief is *in* the transcript,
 * because the reviewer opened it with a tool and the tool result was printed.
 * Reviewer briefs necessarily contain words like "accept" and "revise", so
 * counting them as the reviewer's own speech let an invented verdict quote the
 * instructions — silent wrong acceptance, through the one check meant to
 * prevent it.
 */
test("text from the brief the reviewer read cannot support a verdict", async () => {
  const transcript = await fixture("claude-reviewer-revise.jsonl");
  // The reviewer opened its brief with a tool, so the brief's own words are in
  // the transcript. Measured: this phrase was found by the previous check and
  // is refused by this one.
  const briefInstruction = "Report every defect you find, with file and line references.";
  assert.equal(
    transcriptAllText(transcript).includes(briefInstruction),
    true,
    "guard: the brief really is in this transcript",
  );
  assert.equal(quoteSupportedByTranscript(briefInstruction, transcript), false);
});

test("a reviewer job that only described the file cannot have a verdict quoted from its brief", async () => {
  const transcript = await fixture("claude-no-judgment.jsonl");
  const briefInstruction = "Do not evaluate its quality, do not look for defects, and do not make any";
  assert.equal(transcriptAllText(transcript).includes(briefInstruction), true, "guard");
  assert.equal(quoteSupportedByTranscript(briefInstruction, transcript), false);
});

/**
 * Also raised as a Critical, also confirmed. "this should be accepted as it
 * stands" is a contiguous span inside "I don't think this should be accepted as
 * it stands". Presence alone cannot tell the two apart, so a quote must at least
 * start where a sentence starts.
 */
test("a fragment lifted out of the middle of a negation cannot support a verdict", async () => {
  const transcript = await fixture("claude-reviewer-revise.jsonl");
  assert.equal(quoteSupportedByTranscript("this should be accepted as it stands.", transcript), false);
});

/**
 * Measured by the independent claude review, 2026-07-25: the first version of
 * the boundary rule rejected a verdict written as a list item, a block quote, a
 * table cell, or after an em dash — all ordinary reviewer formatting. A
 * rejection is not a downgrade to indeterminate: it fails the job, and the
 * supervisor counts that as a lane fault. Over-constraining the reviewer is the
 * exact failure this whole change exists to remove, so it must not reappear in
 * the check that polices it.
 */
for (const [label, line] of [
  ["a list item", "- **Accept as it stands.** I found nothing that must be fixed first."],
  ["a dashed list item", "* Accept as it stands. I found nothing that must be fixed first."],
  ["a block quote", "> Accept as it stands. I found nothing that must be fixed first."],
  ["a table cell", "| Verdict | Accept as it stands. I found nothing that must be fixed first. |"],
  ["an em-dash lead-in", "Verdict — Accept as it stands. I found nothing that must be fixed first."],
  ["a numbered item", "1. Accept as it stands. I found nothing that must be fixed first."],
  ["a parenthesis", "(Accept as it stands. I found nothing that must be fixed first.)"],
] as const) {
  test(`a verdict written as ${label} still supports itself`, () => {
    const transcript = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: `## Verdict\n${line}` }] },
    });
    assert.equal(
      quoteSupportedByTranscript("Accept as it stands. I found nothing that must be fixed first.", transcript),
      true,
      `${label} must not fail a correct verdict`,
    );
  });
}

/**
 * Round 4 of independent review, 2026-07-25: making separator tokens open a
 * boundary — which is what lets "Verdict — Accept as it stands" work — also
 * re-admitted the mid-clause lift that the boundary rule was added to stop,
 * whenever ordinary punctuation sits between the negation and the fragment.
 *
 * Formatting must stay permissive, so the fix is not to narrow the boundary
 * again but to bind polarity: an `accept` cannot rest on words a refusal was
 * leading up to.
 */
for (const [label, text] of [
  ["an em dash", "I don't think — this should be accepted as it stands."],
  ["a hyphen", "I don't think - this should be accepted as it stands."],
  ["a colon", "I don't think: this should be accepted as it stands."],
  ["a semicolon", "I cannot approve it; this should be accepted as it stands only later."],
] as const) {
  test(`a lift after ${label} inside a refusal cannot support an accept`, () => {
    const transcript = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text }] },
    });
    assert.equal(
      quoteSupportedByTranscript("this should be accepted as it stands.", transcript, "accept"),
      false,
      `${label} must not launder a refusal into an acceptance`,
    );
  });
}

test("a whole negated sentence cannot support an accept, however it is quoted", async () => {
  const transcript = await fixture("claude-reviewer-revise.jsonl");
  // The reviewer's own words, quoted honestly — but they are a refusal, so they
  // cannot be the evidence for an acceptance.
  assert.equal(quoteSupportedByTranscript(REVISE_QUOTE, transcript, "accept"), false);
  // The same words remain valid evidence for the verdict they actually express.
  assert.equal(quoteSupportedByTranscript(REVISE_QUOTE, transcript, "revise"), true);
});

test("an accept quoted from a genuine approval is still supported", async () => {
  const transcript = await fixture("claude-reviewer-accept.jsonl");
  assert.equal(quoteSupportedByTranscript(ACCEPT_QUOTE, transcript, "accept"), true);
});

test("skipping markers does not let a quote start mid-word", () => {
  const transcript = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "I do not think this should be accepted as it stands." }] },
  });
  assert.equal(quoteSupportedByTranscript("this should be accepted as it stands.", transcript), false);
});

test("the reviewer's own recommendation still supports its verdict", async () => {
  // The fix must not make correct verdicts unverifiable: this is the real
  // sentence, starting where the reviewer started it.
  const transcript = await fixture("claude-reviewer-revise.jsonl");
  assert.equal(quoteSupportedByTranscript(REVISE_QUOTE, transcript), true);
});

test("a quote cannot be stitched across two separate messages", async () => {
  const transcript = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "The loop bound is wrong." }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Accept as it stands anyway." }] } }),
  ].join("\n");
  assert.equal(quoteSupportedByTranscript("The loop bound is wrong. Accept as it stands anyway.", transcript), false);
  assert.equal(quoteSupportedByTranscript("Accept as it stands anyway.", transcript), true);
});

test("an empty or whitespace-only quote is never supported", () => {
  assert.equal(quoteSupportedByTranscript("", "anything"), false);
  assert.equal(quoteSupportedByTranscript("      ", "anything"), false);
});

/**
 * Measured by the real-CLI gate, 2026-07-25: a cursor reviewer ended with
 * "### Recommendation\n\n**Revise it.**" and the managing agent quoted exactly
 * that. The minimum-length floor refused it, so a correct verdict became a
 * failed job — the same over-constraint this change exists to remove, this time
 * inflicted on how briefly a reviewer is allowed to speak.
 *
 * A short quote is still evidence when it is a whole statement standing where a
 * statement starts.
 */
test("a short but complete recommendation is supported", () => {
  const transcript = JSON.stringify({
    type: "result",
    result: "### Defects\n\n1. Off-by-one.\n\n### Recommendation\n\n**Revise it.**",
  });
  assert.equal(quoteSupportedByTranscript("Revise it.", transcript, "revise"), true);
});

test("a short fragment that is not a whole statement is still refused", () => {
  const transcript = JSON.stringify({ type: "result", result: "Everything is ok here, mostly." });
  assert.equal(quoteSupportedByTranscript("ok here", transcript, "accept"), false);
  assert.equal(quoteSupportedByTranscript("is ok", transcript, "accept"), false);
});

test("a short accept is bound by polarity within its own statement", () => {
  const inStatement = JSON.stringify({
    type: "result",
    result: "I cannot sign this off — accept it.",
  });
  assert.equal(quoteSupportedByTranscript("accept it.", inStatement, "accept"), false);

  // The limit, stated rather than implied: polarity reaches back to the start of
  // the statement a quote belongs to, not through everything said before it. A
  // reviewer who refuses in one sentence and approves in the next has
  // contradicted itself, and reading that contradiction is the model's job —
  // widening the rule instead would refuse legitimate approvals that happen to
  // follow a negative sentence ("The tests do not cover X yet. Accept as it
  // stands."), which fails correct work into a paused lane.
  const acrossSentences = JSON.stringify({
    type: "result",
    result: "I cannot sign this off. Accept it.",
  });
  assert.equal(quoteSupportedByTranscript("Accept it.", acrossSentences, "accept"), true);
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

/**
 * Regression from the 2026-07-26 QK-UI-008 campaign, which paused on a verdict
 * everyone agreed with.
 *
 * The reviewer approved the change and said so plainly, but every quote it could
 * offer contained the word "not" — because that is how a reviewer says a change
 * is clean. A bare negation counted as a refusal cue, so both attempts were
 * rejected as unsupported and the accept degraded to indeterminate.
 */
test("an approving sentence is not a refusal merely for containing a negation", () => {
  const transcript = "The same 3 path-with-spaces CLI failures exist on 18d8021, and a11y /"
    + " table-performance / approval Playwright specs all passed there. That supports the accept"
    + " verdict — those check failures are not regressions from QK-UI-008.";
  const quote = "That supports the accept verdict — those check failures are not regressions from QK-UI-008.";

  assert.equal(quoteSupportedByTranscript(quote, transcript, "accept"), true);
});

test("a negation landing on approval itself still refuses an accept", () => {
  const transcript = "I reviewed the diff carefully. I would not accept this as it stands.";
  const quote = "I would not accept this as it stands.";

  assert.equal(quoteSupportedByTranscript(quote, transcript, "accept"), false);
});

test("a refusal in the run-up still cannot launder approving words into an accept", () => {
  const transcript = "I don't think — this should be accepted as it stands.";
  const quote = "this should be accepted as it stands.";

  assert.equal(quoteSupportedByTranscript(quote, transcript, "accept"), false);
});
