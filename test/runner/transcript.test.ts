import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  boundedTranscriptExcerpt,
  transcriptQuoteHaystack,
  transcriptSessionHandle,
} from "../../src/runner/transcript.js";

function fixture(name: string): Promise<string> {
  return readFile(path.resolve("test/fixtures/real-transcripts", name), "utf8");
}

test("the haystack decodes JSON string values so an escaped newline stops hiding a quote", async () => {
  const transcript = await fixture("claude-reviewer-revise.jsonl");
  // Two rendered lines of the reviewer's own recommendation. In the transcript
  // the break between them is the two characters \ and n inside a JSON string,
  // so a raw substring search over the file never finds this.
  const quote = "## Recommendation\n\n**Revise.** I don't think this should be accepted as it stands.";
  assert.equal(transcript.includes(quote), false, "guard: the raw file must not contain it verbatim");
  assert.equal(transcriptQuoteHaystack(transcript).includes(quote), true);
});

test("the haystack keeps non-JSON lines rather than discarding them", () => {
  const haystack = transcriptQuoteHaystack("not json at all\n{\"type\":\"result\",\"result\":\"structured part\"}\n");
  assert.equal(haystack.includes("not json at all"), true);
  assert.equal(haystack.includes("structured part"), true);
});

test("the haystack reaches strings nested inside arrays and objects", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "deeply nested finding" }] },
  });
  assert.equal(transcriptQuoteHaystack(line).includes("deeply nested finding"), true);
});

test("a claude session id is recovered from a real transcript", async () => {
  const handle = transcriptSessionHandle(await fixture("claude-reviewer-revise.jsonl"));
  assert.match(handle ?? "", /^[0-9a-f-]{36}$/);
});

test("a cursor session id is recovered from its single-document transcript", async () => {
  const handle = transcriptSessionHandle(await fixture("cursor-reviewer-revise.jsonl"));
  assert.equal(typeof handle, "string");
  assert.equal((handle ?? "").length > 0, true);
});

test("a codex thread id is recovered even from a failed run", async () => {
  const handle = transcriptSessionHandle(await fixture("codex-usage-limit.jsonl"));
  assert.equal(handle, "019f96fc-4055-7ba1-9619-0dba7bc155d0");
});

test("a transcript with no session identifier yields undefined rather than a guess", () => {
  assert.equal(transcriptSessionHandle('{"type":"result","result":"done"}'), undefined);
});

test("an under-budget transcript is passed through whole and reports no elision", () => {
  const excerpt = boundedTranscriptExcerpt("short transcript", 1024);
  assert.equal(excerpt.text, "short transcript");
  assert.equal(excerpt.elidedBytes, 0);
});

test("an over-budget transcript keeps its head and its tail and says what it dropped", () => {
  const transcript = `HEAD_MARKER\n${"x".repeat(5_000)}\nTAIL_MARKER`;
  const excerpt = boundedTranscriptExcerpt(transcript, 1_000);
  assert.equal(excerpt.text.includes("HEAD_MARKER"), true);
  // A reviewer's recommendation comes last, so the tail is what must survive.
  assert.equal(excerpt.text.includes("TAIL_MARKER"), true);
  assert.equal(excerpt.elidedBytes > 0, true);
  assert.match(excerpt.text, /elided/i);
  assert.equal(excerpt.text.length <= 1_200, true);
});
