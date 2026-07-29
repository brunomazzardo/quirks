// How a reviewer's judgment gets out of a transcript and into a run record.
//
// The gap this closes: `dispatchRunner` emits transport notes only — flood,
// fault, transcript-write — so the `quote:` note the parent looked for was
// produced by nothing but the test suite. Every real review therefore reached
// `resolveVerdict` with an empty quote, which correctly fails closed to
// `indeterminate` — meaning the default configuration could not complete a
// single task. Failing closed was right; having nothing to open with was not.
//
// So the reviewer is asked to DECLARE, in its own last words, a verdict and one
// sentence of evidence. This module reads that declaration back out. It does not
// verify it: `resolveVerdict` still checks the quote against the retained
// transcript mechanically, and an `accept` still may not rest on words a refusal
// was leading up to. Declaration is how a judgment is stated; verification is
// how it is believed, and they stay separate.

import type { DispatchStatus } from "./Types.ts";
import { DECLARATION_PREFIX, transcriptAuthoredText, type Verdict } from "./Quote.ts";

// Line-leading, so prose that merely mentions a marker cannot declare. Both are
// built from Quote.ts's `DECLARATION_PREFIX` — the same source that file's
// haystack FILTER is built from. Hand-writing the prefix twice is how a parser
// comes to accept a decoration the filter does not strip, which would let an
// evidence line verify itself again (see Quote.ts).
const DECLARED_VERDICT = new RegExp(
  `${DECLARATION_PREFIX}VERDICT:[ \\t]*(accept|revise|indeterminate)\\b`,
  "gim",
);
const DECLARED_EVIDENCE = new RegExp(`${DECLARATION_PREFIX}EVIDENCE:[ \\t]*(.+)$`, "gim");

/** Surrounding quotation marks are presentation, not part of the sentence. */
function unwrap(value: string): string {
  const trimmed = value.trim();
  const first = trimmed.at(0);
  const last = trimmed.at(-1);
  if (first !== undefined && last !== undefined && first === last && /["'`]/.test(first)) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** The last match wins: a reviewer that reconsiders mid-transcript ends on its
 *  actual judgment, and an early draft never outranks the final one.
 *
 *  `matchAll` clones the regex, so these module-level `/g` patterns carry no
 *  `lastIndex` between calls — the state a manual `exec` loop has to remember to
 *  reset, and the next caller has to remember it did. */
function lastMatch(pattern: RegExp, haystack: string): string | undefined {
  return [...haystack.matchAll(pattern)].at(-1)?.[1];
}

export interface DeclaredVerdict {
  readonly claimed: Verdict;
  readonly quote: string;
}

/**
 * The verdict a reviewer declared in its own authored messages, or null.
 *
 * Read from `transcriptAuthoredText`, never the raw transcript: the brief the
 * reviewer was handed carries the instruction describing this very format, and a
 * brief is not a judgment. Only what the runner itself said counts. (The
 * verification haystack is the same text with these lines removed, so evidence
 * can never be proved by the line that declared it — see Quote.ts.)
 */
export function parseDeclaredVerdict(transcript: string): DeclaredVerdict | null {
  const authored = transcriptAuthoredText(transcript);
  const claimed = lastMatch(DECLARED_VERDICT, authored);
  if (claimed === undefined) return null;
  const evidence = lastMatch(DECLARED_EVIDENCE, authored);
  return {
    claimed: claimed.toLowerCase() as Verdict,
    quote: evidence === undefined ? "" : unwrap(evidence),
  };
}

/** A transport failure is not a judgment — a reviewer that crashed reviewed
 *  nothing. `failure` is the one case that carries information (the runner ran
 *  and exited non-zero, which every runner uses to mean "changes wanted"). */
function claimFromTransport(status: DispatchStatus): Verdict {
  return status === "failure" ? "revise" : "indeterminate";
}

/**
 * What the reviewer claims, before anything is believed.
 *
 * Order: a declaration in the runner's own words, then the `quote:` note seam a
 * runner integration may surface structurally, then absence. Absence is
 * `indeterminate` with an empty quote, which `resolveVerdict` maps to
 * `indeterminate` again — nothing here can manufacture an `accept`.
 */
export function reviewClaim(outcome: {
  readonly status: DispatchStatus;
  readonly transcript: string;
  readonly notes?: readonly string[] | undefined;
}): DeclaredVerdict {
  if (outcome.status !== "success") {
    return { claimed: claimFromTransport(outcome.status), quote: "" };
  }
  const declared = parseDeclaredVerdict(outcome.transcript);
  if (declared !== null) return declared;

  const noted = outcome.notes?.find((note) => note.startsWith("quote:"))?.slice("quote:".length);
  if (noted !== undefined) return { claimed: "accept", quote: noted };

  return { claimed: "indeterminate", quote: "" };
}

/**
 * What a reviewer's brief tells it to end with.
 *
 * The placeholder is deliberate: `<accept|revise>` does not itself parse as a
 * declaration, so a runner that echoes its instructions back has not thereby
 * declared anything. And the evidence must REPEAT a sentence from the review
 * body — that is what gives the quote a real sentence boundary to be verified
 * against, rather than one manufactured by the marker line itself.
 */
/**
 * The PROMPT a reviewer is launched with — not just the brief field.
 *
 * The brief carries `review.instructions` as a durable record, but a runner only
 * obeys what its prompt actually says, and every adapter's prompt was
 * role-blind: claude received a bare path, and cursor's says "Read the brief at
 * <path> and **complete it**" — an instruction to implement, handed to a
 * reviewer. Only codex saw the instructions at all, and only when the brief was
 * small enough to inline. A reviewer that never reads `review.instructions[]`
 * declares nothing, `reviewClaim` returns `indeterminate`, and the default
 * configuration still cannot complete a task — the failure this module exists
 * to fix, moved one layer out.
 *
 * The brief is referenced BY PATH, never inlined: argv is world-visible in `ps`.
 */
export function reviewPromptText(briefPath: string): string {
  return [`Read the brief at ${briefPath}.`, ...REVIEW_INSTRUCTIONS].join("\n");
}

export const REVIEW_INSTRUCTIONS: readonly string[] = [
  "You are the REVIEWER for this task. Do not implement anything; judge the work already in the worktree against the acceptance criteria and verification above.",
  "Write your review first, in ordinary prose, including at least one complete sentence stating your conclusion and why.",
  "Then end your final message with exactly two lines:",
  "QUIRKS-VERDICT: <accept|revise|indeterminate>",
  "QUIRKS-EVIDENCE: <one complete sentence, copied verbatim from your review above>",
  "The evidence sentence is checked, character for character, against the transcript of what you actually said. A sentence you did not write, or a verdict with no evidence, is recorded as indeterminate — which is a failure for this task, not a neutral outcome.",
];
