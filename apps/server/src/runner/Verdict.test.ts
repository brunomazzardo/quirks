// Reading a declared verdict back out of a reviewer's own words.
//
// The regression this file exists for: before it, the only producers of a
// `quote:` note in the whole repo were two test files, so every real review
// resolved to `indeterminate` and no task could ever complete.

import { describe, expect, it } from "vite-plus/test";
import { parseDeclaredVerdict, reviewClaim, reviewPromptText } from "./Verdict.ts";
import { resolveVerdict } from "./Quote.ts";

/** A claude stream-json transcript of one assistant message. */
const said = (...texts: readonly string[]): string =>
  texts
    .map((text) =>
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }),
    )
    .join("\n");

const REVIEW = [
  "I read the diff and ran the suite.",
  "The migration preserves every existing column default.",
  "",
  "QUIRKS-VERDICT: accept",
  "QUIRKS-EVIDENCE: The migration preserves every existing column default.",
].join("\n");

describe("parseDeclaredVerdict", () => {
  it("reads the verdict and evidence a reviewer declared", () => {
    expect(parseDeclaredVerdict(said(REVIEW))).toEqual({
      claimed: "accept",
      quote: "The migration preserves every existing column default.",
    });
  });

  it("returns null when nothing was declared", () => {
    expect(parseDeclaredVerdict(said("Looks fine to me."))).toBeNull();
  });

  it("ignores a declaration that is not the runner's own words", () => {
    // A user/brief message carrying the instructions is not a judgment.
    const brief = JSON.stringify({
      type: "user",
      message: { content: [{ type: "text", text: "QUIRKS-VERDICT: accept" }] },
    });
    expect(parseDeclaredVerdict(brief)).toBeNull();
  });

  it("does not treat the instruction placeholder as a declaration", () => {
    expect(parseDeclaredVerdict(said("QUIRKS-VERDICT: <accept|revise|indeterminate>"))).toBeNull();
  });

  it("takes the last declaration — a reviewer may reconsider", () => {
    const text = ["QUIRKS-VERDICT: accept", "wait — I misread the test.", "QUIRKS-VERDICT: revise"];
    expect(parseDeclaredVerdict(said(text.join("\n")))?.claimed).toBe("revise");
  });

  it("strips quotation marks around the evidence", () => {
    const text = ['QUIRKS-VERDICT: accept', 'QUIRKS-EVIDENCE: "It is correct."'].join("\n");
    expect(parseDeclaredVerdict(said(text))?.quote).toBe("It is correct.");
  });
});

describe("reviewClaim", () => {
  it("carries a declared accept through to a verified verdict", () => {
    const transcript = said(REVIEW);
    const claim = reviewClaim({ status: "success", transcript });
    expect(claim.claimed).toBe("accept");
    // End to end: the declaration is only believed because the sentence really
    // appears in the review body, at a sentence boundary.
    expect(resolveVerdict({ ...claim, transcript })).toBe("accept");
  });

  it("refuses an accept whose evidence the reviewer never wrote", () => {
    const transcript = said(
      ["I have concerns.", "QUIRKS-VERDICT: accept", "QUIRKS-EVIDENCE: Everything is perfect."].join(
        "\n",
      ),
    );
    const claim = reviewClaim({ status: "success", transcript });
    expect(claim.claimed).toBe("accept");
    // Declared, but unsupported — verification fails it closed.
    expect(resolveVerdict({ ...claim, transcript })).toBe("indeterminate");
  });

  it("is indeterminate when a successful reviewer declared nothing", () => {
    const transcript = said("Looks good, shipping it.");
    expect(reviewClaim({ status: "success", transcript })).toEqual({
      claimed: "indeterminate",
      quote: "",
    });
  });

  it("never lets a crashed or timed-out reviewer accept", () => {
    const transcript = said(REVIEW);
    for (const status of ["timeout", "cancelled"] as const) {
      expect(reviewClaim({ status, transcript })).toEqual({ claimed: "indeterminate", quote: "" });
    }
    expect(reviewClaim({ status: "failure", transcript }).claimed).toBe("revise");
  });

  it("still honours the structural quote: note seam", () => {
    expect(
      reviewClaim({
        status: "success",
        transcript: said("nothing declared here"),
        notes: ["quote:The change is correct."],
      }),
    ).toEqual({ claimed: "accept", quote: "The change is correct." });
  });
});

describe("reviewPromptText", () => {
  it("states the role and the declaration, and never inlines the brief", () => {
    const prompt = reviewPromptText("/tmp/art/review-brief.json");
    // Every adapter's prompt used to be role-blind — cursor's told a reviewer to
    // "complete it" — so the contract reached the runner only if it happened to
    // read a nested brief field.
    expect(prompt).toContain("REVIEWER");
    expect(prompt).toContain("QUIRKS-VERDICT:");
    expect(prompt).toContain("QUIRKS-EVIDENCE:");
    // argv is world-visible in `ps`: the brief is referenced, never pasted.
    expect(prompt).toContain("/tmp/art/review-brief.json");
  });

  it("is not itself a declaration — echoing the instructions declares nothing", () => {
    expect(parseDeclaredVerdict(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: reviewPromptText("/tmp/b.json") }] },
      }),
    )).toBeNull();
  });
});
