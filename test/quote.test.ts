// QK-RUN-004 — TDD: these tests define the honesty core before the code exists.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  quoteSupportedByTranscript,
  resolveVerdict,
  transcriptQuoteHaystack,
} from "../src/runner/quote.ts";

const FIX = join(import.meta.dir, "fixtures/real-transcripts");
const fixture = (name: string) => readFileSync(join(FIX, name), "utf8");

const REVISE_QUOTE = "**Revise.** I don't think this should be accepted as it stands.";
const ACCEPT_QUOTE =
  "**Accept as it stands.** I found nothing that must be fixed before this lands.";

function assistant(text: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  });
}

describe("transcriptQuoteHaystack — only the runner's own words", () => {
  test("assistant text counts; tool results and user prompts do not", () => {
    const transcript = [
      JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "accept the code as it stands" }] } }),
      JSON.stringify({
        type: "user",
        message: {
          content: [{ type: "tool_result", content: "Report every defect. Accept or revise." }],
        },
      }),
      assistant("Revise. The loop bound is wrong."),
    ].join("\n");
    const hay = transcriptQuoteHaystack(transcript);
    expect(hay).toContain("Revise. The loop bound is wrong.");
    expect(hay).not.toContain("accept the code as it stands");
    expect(hay).not.toContain("Report every defect");
  });

  test("brief text present in a real transcript cannot enter the haystack", () => {
    const transcript = fixture("claude-reviewer-revise.jsonl");
    const briefInstruction = "Report every defect you find, with file and line references.";
    // Guard: the brief really is somewhere in the raw transcript.
    expect(transcript.includes(briefInstruction)).toBe(true);
    expect(transcriptQuoteHaystack(transcript).includes(briefInstruction)).toBe(false);
  });
});

describe("quoteSupportedByTranscript", () => {
  test("a verbatim quote from a real reviewer transcript is supported", () => {
    expect(quoteSupportedByTranscript(REVISE_QUOTE, fixture("claude-reviewer-revise.jsonl"))).toBe(true);
  });

  test("a plausible paraphrase the reviewer never wrote is not supported", () => {
    expect(
      quoteSupportedByTranscript(
        "I have reviewed this carefully and it looks good to me.",
        fixture("claude-reviewer-revise.jsonl"),
      ),
    ).toBe(false);
  });

  test("a fragment lifted from the middle of a negation cannot support a verdict", () => {
    expect(
      quoteSupportedByTranscript(
        "this should be accepted as it stands.",
        fixture("claude-reviewer-revise.jsonl"),
      ),
    ).toBe(false);
  });

  test("dropping markdown emphasis still supports the same words", () => {
    const quote =
      "Revise. I don't think this should be accepted as it stands.";
    expect(quoteSupportedByTranscript(quote, fixture("claude-reviewer-revise.jsonl"))).toBe(true);
  });

  test("an accept cannot rest on words a refusal was leading up to", () => {
    for (const text of [
      "I don't think — this should be accepted as it stands.",
      "I don't think: this should be accepted as it stands.",
      "I cannot approve it; this should be accepted as it stands only later.",
    ]) {
      expect(quoteSupportedByTranscript("this should be accepted as it stands.", assistant(text), "accept")).toBe(
        false,
      );
    }
  });

  test("a whole negated sentence cannot support an accept, but can support revise", () => {
    const transcript = fixture("claude-reviewer-revise.jsonl");
    expect(quoteSupportedByTranscript(REVISE_QUOTE, transcript, "accept")).toBe(false);
    expect(quoteSupportedByTranscript(REVISE_QUOTE, transcript, "revise")).toBe(true);
  });

  test("a genuine accept quote is supported", () => {
    expect(
      quoteSupportedByTranscript(ACCEPT_QUOTE, fixture("claude-reviewer-accept.jsonl"), "accept"),
    ).toBe(true);
  });

  test("a quote cannot be stitched across two separate messages", () => {
    const transcript = [
      assistant("The loop bound is wrong."),
      assistant("Accept as it stands anyway."),
    ].join("\n");
    expect(
      quoteSupportedByTranscript("The loop bound is wrong. Accept as it stands anyway.", transcript),
    ).toBe(false);
    expect(quoteSupportedByTranscript("Accept as it stands anyway.", transcript)).toBe(true);
  });

  test("empty or whitespace-only quotes are never supported", () => {
    expect(quoteSupportedByTranscript("", "anything")).toBe(false);
    expect(quoteSupportedByTranscript("   ", "anything")).toBe(false);
  });

  test("a verdict written as a list item still supports itself", () => {
    const transcript = assistant(
      "## Verdict\n- Accept as it stands. I found nothing that must be fixed first.",
    );
    expect(
      quoteSupportedByTranscript(
        "Accept as it stands. I found nothing that must be fixed first.",
        transcript,
      ),
    ).toBe(true);
  });
});

describe("resolveVerdict — absence fails closed to indeterminate", () => {
  test("nothing maps absence to accept", () => {
    expect(resolveVerdict({ claimed: "accept", quote: "", transcript: assistant("anything") })).toBe(
      "indeterminate",
    );
    expect(
      resolveVerdict({
        claimed: "accept",
        quote: "words never spoken by anyone here at all",
        transcript: assistant("something else entirely"),
      }),
    ).toBe("indeterminate");
  });

  test("a supported accept quote resolves to accept", () => {
    expect(
      resolveVerdict({
        claimed: "accept",
        quote: ACCEPT_QUOTE,
        transcript: fixture("claude-reviewer-accept.jsonl"),
      }),
    ).toBe("accept");
  });

  test("a no-judgment transcript cannot yield accept", () => {
    expect(
      resolveVerdict({
        claimed: "accept",
        quote: ACCEPT_QUOTE,
        transcript: fixture("claude-no-judgment.jsonl"),
      }),
    ).toBe("indeterminate");
  });
});
