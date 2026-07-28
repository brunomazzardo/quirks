// Quote verification — the honesty core (QK-RUN-004).
// Carried from v1's managing-agent contract after five cross-vendor review
// rounds. Behavior lands test-first; absence fails closed to indeterminate.

export type Verdict = "accept" | "revise" | "indeterminate";

/** Separator between authored messages — a NUL wall so quotes cannot stitch. */
export const AUTHORED_MESSAGE_SEPARATOR = "\n\u0000\n";

function claudeAssistantText(event: Record<string, unknown>, into: string[]): void {
  const message = event["message"];
  if (typeof message !== "object" || message === null) return;
  const content = (message as Record<string, unknown>)["content"];
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const record = block as Record<string, unknown>;
    if (record["type"] === "text" && typeof record["text"] === "string") into.push(record["text"]);
  }
}

function codexAgentMessage(event: Record<string, unknown>, into: string[]): void {
  const item = event["item"];
  if (typeof item !== "object" || item === null) return;
  const record = item as Record<string, unknown>;
  if (record["type"] === "agent_message" && typeof record["text"] === "string") into.push(record["text"]);
}

/**
 * Only what the runner itself said — never the brief it read or a tool result.
 * Quoting instructions like "accept the code as it stands" is not a judgment.
 */
export function transcriptQuoteHaystack(transcript: string): string {
  const authored: string[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      authored.push(line);
      continue;
    }
    const events = Array.isArray(parsed) ? parsed : [parsed];
    for (const event of events) {
      if (typeof event !== "object" || event === null) continue;
      const record = event as Record<string, unknown>;
      if (record["type"] === "assistant") claudeAssistantText(record, authored);
      if (record["type"] === "result" && typeof record["result"] === "string") {
        authored.push(record["result"]);
      }
      if (record["type"] === "item.completed") codexAgentMessage(record, authored);
    }
  }
  return authored.join(AUTHORED_MESSAGE_SEPARATOR);
}

const MIN_QUOTE_SIGNIFICANT_CHARS = 12;
const MIN_COMPLETE_STATEMENT_CHARS = 6;
const APPROVAL_LOOKBACK_CHARS = 120;

const REFUSAL_CUES =
  /\b(?:don't|do not|doesn't|does not|cannot|can't|won't|will not|shouldn't|should not|wouldn't|would not|isn't|is not|refuses?|refused|rejects?|rejected|unless|not\s+(?:accept\w*|approv\w*|ready|suitable|mergeable)|never\s+(?:accept\w*|approv\w*))\b/;

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

const STATEMENT_TERMINATORS = new Set([".", "!", "?", ":", ";"]);
const SENTENCE_TERMINATORS = new Set([".", "!", "?"]);

function isWordCharacter(character: string): boolean {
  return /[\p{L}\p{N}]/u.test(character);
}

interface NormalizedHaystack {
  text: string;
  starts: ReadonlySet<number>;
  hardStarts: ReadonlySet<number>;
}

function normalizeHaystack(value: string): NormalizedHaystack {
  const folded = foldPresentation(value);
  const starts = new Set<number>([0]);
  const hardStarts = new Set<number>([0]);
  let text = "";
  let pendingBoundary = true;
  let pendingHardBoundary = true;
  let sawWhitespace = false;
  let lastMeaningful = "";
  let tokenHasWord = false;
  let tokenLength = 0;

  for (const character of folded) {
    if (/\s/.test(character)) {
      sawWhitespace = true;
      if (STATEMENT_TERMINATORS.has(lastMeaningful)) pendingBoundary = true;
      if (SENTENCE_TERMINATORS.has(lastMeaningful)) pendingHardBoundary = true;
      if (character === "\n" || character === "\r") {
        pendingBoundary = true;
        pendingHardBoundary = true;
      }
      if (tokenLength > 0 && !tokenHasWord) pendingBoundary = true;
      tokenHasWord = false;
      tokenLength = 0;
      continue;
    }
    if (text.length > 0 && sawWhitespace) text += " ";
    if (pendingBoundary) starts.add(text.length);
    if (pendingHardBoundary) hardStarts.add(text.length);
    text += character;
    tokenLength += 1;
    if (isWordCharacter(character)) tokenHasWord = true;
    pendingBoundary = pendingBoundary && !isWordCharacter(character);
    pendingHardBoundary = pendingHardBoundary && !isWordCharacter(character);
    lastMeaningful = character;
    sawWhitespace = false;
  }

  return { text, starts, hardStarts };
}

function refusalLeadsInto(haystack: NormalizedHaystack, index: number, needle: string): boolean {
  if (REFUSAL_CUES.test(needle)) return true;
  let lookbackStart = Math.max(0, index - APPROVAL_LOOKBACK_CHARS);
  for (let offset = index; offset > lookbackStart; offset -= 1) {
    if (haystack.hardStarts.has(offset)) {
      lookbackStart = offset;
      break;
    }
  }
  return REFUSAL_CUES.test(haystack.text.slice(lookbackStart, index));
}

/**
 * Whether a quote genuinely appears in the runner's own words.
 * 1. Only authored messages (not the brief / tool results).
 * 2. Quote begins at a statement boundary.
 * 3. Markup / wrapping / case forgiven; words and order are not.
 * An `accept` may not rest on words a refusal was leading up to.
 */
export function quoteSupportedByTranscript(
  quote: string,
  transcript: string,
  verdict?: Verdict,
): boolean {
  const needle = normalizeQuoteText(quote);
  const significant = needle.replaceAll(/\s/g, "").length;
  if (significant < MIN_COMPLETE_STATEMENT_CHARS) return false;
  const mustBeWholeStatement = significant < MIN_QUOTE_SIGNIFICANT_CHARS;
  if (mustBeWholeStatement && !SENTENCE_TERMINATORS.has(needle.at(-1) ?? "")) return false;

  const haystack = normalizeHaystack(transcriptQuoteHaystack(transcript));
  for (
    let index = haystack.text.indexOf(needle);
    index !== -1;
    index = haystack.text.indexOf(needle, index + 1)
  ) {
    if (!haystack.starts.has(index)) continue;
    if (mustBeWholeStatement && !haystack.hardStarts.has(index)) continue;
    if (verdict === "accept" && refusalLeadsInto(haystack, index, needle)) continue;
    return true;
  }
  return false;
}

/**
 * Resolve a claimed verdict against the retained transcript.
 * Absence — empty quote, unsupported quote, or fabrications — fails closed
 * to `indeterminate`. Nothing here maps absence to `accept`.
 */
export function resolveVerdict(input: {
  claimed: Verdict;
  quote: string;
  transcript: string;
}): Verdict {
  if (input.claimed === "indeterminate") return "indeterminate";
  if (!input.quote.trim()) return "indeterminate";
  if (!quoteSupportedByTranscript(input.quote, input.transcript, input.claimed)) {
    return "indeterminate";
  }
  return input.claimed;
}
