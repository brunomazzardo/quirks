import type { ReviewFinding } from "../interpretation.js";
import { transcriptQuoteHaystack } from "../transcript.js";
import type { RunnerJobStatus } from "../types.js";

/**
 * What the managing agent returns, and the trust boundary for reading it.
 *
 * The agent is a model, so this module treats its output the way every other
 * runner output is treated here: parsed strictly, never coerced. The
 * difference from the envelope contract this replaces is where the strictness
 * sits. We no longer ask three third-party CLIs to satisfy a schema they were
 * not built for; we ask one model we launch ourselves, with one schema, and we
 * can re-prompt it when it misses.
 */

export type ManagingAgentVerdict = "accept" | "revise" | "indeterminate";

export interface ManagingAgentReport {
  status: RunnerJobStatus;
  verdict: ManagingAgentVerdict | null;
  /** A verbatim, contiguous quote from the transcript supporting the verdict. */
  verdictEvidence: string;
  findings: readonly ReviewFinding[];
  artifactPaths: readonly string[];
  sessionHandle: string | null;
  failure: { code: string; message: string } | null;
  summary: string;
}

export const MAX_VERDICT_EVIDENCE_CHARS = 512;

const STATUSES: ReadonlySet<string> = new Set<RunnerJobStatus>([
  "success",
  "failure",
  "cancelled",
  "timeout",
  "usage_limit",
  "permission_denied",
]);

const VERDICTS: ReadonlySet<string> = new Set<ManagingAgentVerdict>(["accept", "revise", "indeterminate"]);

const SEVERITIES: ReadonlySet<string> = new Set<ReviewFinding["severity"]>([
  "critical",
  "important",
  "minor",
  "note",
]);

/**
 * The JSON Schema handed to `claude --json-schema`.
 *
 * Verified against the real CLI (2.1.220): the terminal `result` event carries
 * the validated object in `structured_output`. The descriptions are part of the
 * contract, not decoration — they are the only text the model sees alongside
 * the system brief when it decides whether it is allowed to answer.
 */
export const MANAGING_AGENT_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "verdict",
    "verdictEvidence",
    "findings",
    "artifactPaths",
    "sessionHandle",
    "failure",
    "summary",
  ],
  properties: {
    status: {
      enum: ["success", "failure", "cancelled", "timeout", "usage_limit", "permission_denied"],
      description:
        "Whether the job RAN, never whether its work was any good. A reviewer that completed a review and is asking for changes ran successfully.",
    },
    verdict: {
      enum: ["accept", "revise", "indeterminate", null],
      description:
        "For a reviewer job only, the recommendation the reviewer itself stated. Use \"indeterminate\" when the transcript contains no such statement. Never infer one. Use null for a non-reviewer job.",
    },
    verdictEvidence: {
      type: "string",
      maxLength: MAX_VERDICT_EVIDENCE_CHARS,
      description:
        "The reviewer's own words supporting the verdict, quoted verbatim and contiguously from the transcript, with no ellipsis and no rewording. Empty string when the verdict is indeterminate or null. This is checked against the transcript.",
    },
    findings: {
      type: "array",
      maxItems: 64,
      description: "Defects the runner itself reported. Copy them; never add your own.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "title", "detail"],
        properties: {
          severity: { enum: ["critical", "important", "minor", "note"] },
          title: { type: "string", maxLength: 200 },
          detail: { type: "string", maxLength: 4000 },
          file: { type: "string", maxLength: 1024 },
          line: { type: "integer", minimum: 1, maximum: 1000000 },
        },
      },
    },
    artifactPaths: {
      type: "array",
      maxItems: 64,
      items: { type: "string", minLength: 1, maxLength: 4096 },
      description: "File paths the transcript says the run wrote. Existence is verified afterwards.",
    },
    sessionHandle: {
      type: ["string", "null"],
      maxLength: 256,
      description: "The session or thread id the transcript reports, or null.",
    },
    failure: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["code", "message"],
      properties: {
        code: { type: "string", maxLength: 64 },
        message: { type: "string", maxLength: 2048 },
      },
      description: "Why the job failed to run, or null. Never review findings.",
    },
    summary: {
      type: "string",
      maxLength: 2000,
      description: "One short paragraph describing what the run did, in your own words.",
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFinding(raw: unknown): ReviewFinding | undefined {
  if (!isRecord(raw)) return undefined;
  const { severity, title, detail, file, line } = raw;
  if (typeof severity !== "string" || !SEVERITIES.has(severity)) return undefined;
  if (typeof title !== "string" || title.length === 0) return undefined;
  if (typeof detail !== "string") return undefined;
  if (file !== undefined && typeof file !== "string") return undefined;
  if (line !== undefined && (typeof line !== "number" || !Number.isInteger(line) || line < 1)) return undefined;
  return {
    severity: severity as ReviewFinding["severity"],
    title,
    detail,
    ...(typeof file === "string" && file.length > 0 ? { file } : {}),
    ...(typeof line === "number" ? { line } : {}),
  };
}

function parseFailure(raw: unknown): { code: string; message: string } | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  const { code, message } = raw;
  if (typeof code !== "string" || code.length === 0) return undefined;
  if (typeof message !== "string") return undefined;
  return { code, message };
}

/**
 * Read the agent's report, or return undefined so the caller can retry.
 *
 * Every rejection here is a rejection of *our own* model's output, which is
 * why it is safe to be strict: unlike a third-party CLI, this one can be asked
 * again with a corrective note.
 */
export function parseManagingAgentReport(raw: unknown): ManagingAgentReport | undefined {
  if (!isRecord(raw)) return undefined;
  const { status, verdict, verdictEvidence, findings, artifactPaths, sessionHandle, failure, summary } = raw;

  if (typeof status !== "string" || !STATUSES.has(status)) return undefined;
  if (verdict !== null && (typeof verdict !== "string" || !VERDICTS.has(verdict))) return undefined;
  if (typeof verdictEvidence !== "string" || verdictEvidence.length > MAX_VERDICT_EVIDENCE_CHARS) return undefined;
  if (!Array.isArray(findings)) return undefined;
  if (!Array.isArray(artifactPaths)) return undefined;
  if (artifactPaths.some((entry) => typeof entry !== "string" || entry.length === 0)) return undefined;
  if (sessionHandle !== null && typeof sessionHandle !== "string") return undefined;
  if (typeof summary !== "string") return undefined;

  const parsedFailure = parseFailure(failure);
  if (parsedFailure === undefined) return undefined;

  const parsedFindings: ReviewFinding[] = [];
  for (const entry of findings) {
    const finding = parseFinding(entry);
    if (!finding) return undefined;
    parsedFindings.push(finding);
  }

  return {
    status: status as RunnerJobStatus,
    verdict: verdict === null ? null : (verdict as ManagingAgentVerdict),
    verdictEvidence,
    findings: parsedFindings,
    artifactPaths: artifactPaths as readonly string[],
    sessionHandle: sessionHandle === null ? null : sessionHandle,
    failure: parsedFailure,
    summary,
  };
}

/** Non-space characters a quote must carry before it can identify anything. */
const MIN_QUOTE_SIGNIFICANT_CHARS = 12;

/**
 * Presentation characters a quote may lose without losing its evidence.
 *
 * Measured against the real CLIs on 2026-07-25: a reviewer wrote
 * "**Revise.** ... returns `NaN` for the most obvious call", and a real sonnet
 * interpretation quoted the words without the markdown. Rejecting that as
 * unsupported would have failed every correct verdict in production while the
 * unit tests stayed green, because the tests hand-wrote the asterisks in.
 *
 * Removing markup cannot admit a fabricated quote: the words and their order
 * still have to appear. Only how they were dressed is forgiven.
 */
const PRESENTATION_CHARACTERS = /[*_`~]/g;

const TYPOGRAPHIC_REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  [/[‘’‛]/g, "'"],
  [/[“”]/g, '"'],
  [/[–—―]/g, "-"],
  [/…/g, "..."],
];

function foldPresentation(value: string): string {
  let normalized = value.normalize("NFKC");
  for (const [pattern, replacement] of TYPOGRAPHIC_REPLACEMENTS) {
    normalized = normalized.replaceAll(pattern, replacement);
  }
  return normalized.replaceAll(PRESENTATION_CHARACTERS, "").toLowerCase();
}

function normalizeQuoteText(value: string): string {
  return foldPresentation(value).replaceAll(/\s+/g, " ").trim();
}

/** Punctuation after which a new statement can begin. */
const STATEMENT_TERMINATORS = new Set([".", "!", "?", ":", ";"]);

/** Whether a character can carry meaning, as opposed to marking up what does. */
function isWordCharacter(character: string): boolean {
  return /[\p{L}\p{N}]/u.test(character);
}

interface NormalizedHaystack {
  text: string;
  /** Offsets in `text` where a statement, line, or message begins. */
  starts: ReadonlySet<number>;
}

/**
 * Normalize the haystack while remembering where sentences begin.
 *
 * Whitespace has to collapse — line wrapping is not evidence — but collapsing it
 * also erases the difference between "…think this should be accepted" and a
 * sentence that starts with "This should be accepted". Recording the starts as
 * offsets keeps both properties at once.
 */
function normalizeHaystack(value: string): NormalizedHaystack {
  const folded = foldPresentation(value);
  const starts = new Set<number>([0]);
  let text = "";
  let pendingBoundary = true;
  let sawWhitespace = false;
  let lastMeaningful = "";
  let tokenHasWord = false;
  let tokenLength = 0;

  for (const character of folded) {
    if (/\s/.test(character)) {
      sawWhitespace = true;
      // A terminator only ends a statement when whitespace follows it, so a
      // path like `sum.js:3:the` does not open one mid-token.
      if (STATEMENT_TERMINATORS.has(lastMeaningful)) pendingBoundary = true;
      if (character === "\n" || character === "\r") pendingBoundary = true;
      // A standalone marker token — a table pipe, an em dash, a bullet — is a
      // separator, so what follows it starts fresh. "Verdict — Accept as it
      // stands" is a verdict stated after a dash, not mid-sentence.
      if (tokenLength > 0 && !tokenHasWord) pendingBoundary = true;
      tokenHasWord = false;
      tokenLength = 0;
      continue;
    }
    if (text.length > 0 && sawWhitespace) text += " ";
    if (pendingBoundary) starts.add(text.length);
    text += character;
    tokenLength += 1;
    if (isWordCharacter(character)) tokenHasWord = true;
    // Markers carry no meaning, so a verdict written as a list item, a block
    // quote, a table cell, or after a dash still begins where its words do.
    // Measured: rejecting those failed ordinary reviewer formatting into a
    // paused lane (independent claude review, 2026-07-25).
    pendingBoundary = pendingBoundary && !isWordCharacter(character);
    lastMeaningful = character;
    sawWhitespace = false;
  }

  return { text, starts };
}

/**
 * Whether a quote genuinely appears in the transcript it claims to come from.
 *
 * This is the mechanism behind "a verdict must be traceable": an interpretation
 * that cannot point at the runner's own words is not an interpretation. Three
 * things have to hold, and each closes a way an accept could be manufactured:
 *
 * 1. The words must come from the runner's own messages, not from the brief it
 *    was handed or a file it read. Reviewer briefs say things like "accept the
 *    code as it stands, or revise it"; quoting the instructions is not evidence
 *    of a judgment.
 * 2. The quote must begin at a statement boundary: the start of a message, a
 *    line, or the first words after `.`/`!`/`?`/`:`/`;` followed by space —
 *    with any leading markup (`-`, `>`, `|`, quotes, brackets) skipped, since a
 *    verdict written as a list item is still a verdict. "this should be
 *    accepted as it stands" is a contiguous span inside "I don't think this
 *    should be accepted as it stands", and presence alone cannot tell those
 *    apart.
 * 3. Line wrapping, markdown, typographic quotes, and case are forgiven,
 *    because none of them are evidence; the words and their order are.
 *
 * Both of the first two were raised as Criticals by the independent cursor
 * review of this change and confirmed against the committed real transcripts.
 *
 * What remains unchecked is meaning, and the boundary rule is a punctuation
 * rule rather than a grammar one: a model that quotes a whole negated sentence
 * and calls it an accept passes, and so would a lift that happens to start
 * right after an abbreviation's full stop. That is the reading, which is the
 * model's job — measured by the real-CLI gate against a reviewer who wrote "I
 * don't think this should be accepted as it stands" — and the retained
 * transcript is what lets a human check it after the fact.
 */
export function quoteSupportedByTranscript(quote: string, transcript: string): boolean {
  const needle = normalizeQuoteText(quote);
  if (needle.replaceAll(/\s/g, "").length < MIN_QUOTE_SIGNIFICANT_CHARS) return false;
  const haystack = normalizeHaystack(transcriptQuoteHaystack(transcript));
  for (let index = haystack.text.indexOf(needle); index !== -1; index = haystack.text.indexOf(needle, index + 1)) {
    if (haystack.starts.has(index)) return true;
  }
  return false;
}
