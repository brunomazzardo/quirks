/**
 * Vendor-agnostic reading of a retained runner transcript.
 *
 * These helpers deliberately know nothing about any CLI's event shape. The
 * runner boundary used to demand a precise envelope from each vendor, and every
 * defect that drained the cmp-uimotion-1 campaign lived in that demand. What is
 * left here are the two mechanical facts worth taking from a transcript without
 * asking a model: which text it contains, and what session it ran under.
 */

const REPLACEMENT_CHARACTER = "�";
const SESSION_KEYS = ["session_id", "thread_id", "chatId", "threadId", "sessionId"] as const;

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, into);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) collectStrings(entry, into);
  }
}

/**
 * Every piece of text a transcript contains, with JSON string escapes decoded.
 *
 * A reviewer's sentence lives inside a JSON string, where a line break is the
 * two characters `\` and `n`. Searching the raw file for a quote that spans a
 * line therefore never matches, which would make quote verification pass only
 * for single-line quotes and silently fail for real ones. Lines that are not
 * JSON are kept verbatim, so a CLI that prints plain prose is not invisible.
 */
export function transcriptQuoteHaystack(transcript: string): string {
  const parts: string[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parts.push(line);
      continue;
    }
    if (typeof parsed === "object" && parsed !== null) {
      collectStrings(parsed, parts);
      continue;
    }
    parts.push(line);
  }
  return parts.join("\n");
}

function findSessionHandle(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findSessionHandle(entry);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of SESSION_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  for (const entry of Object.values(record)) {
    const found = findSessionHandle(entry);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The session or thread identifier a transcript reports, or undefined.
 *
 * Read mechanically rather than asked of the interpreting agent: a resume
 * depends on this string being exact, and an identifier is the one thing in a
 * transcript that has a right answer no reading can improve on.
 */
export function transcriptSessionHandle(transcript: string): string | undefined {
  for (const line of transcript.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const found = findSessionHandle(parsed);
    if (found !== undefined) return found;
  }
  return undefined;
}

function trimReplacementEdges(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === REPLACEMENT_CHARACTER) start += 1;
  while (end > start && value[end - 1] === REPLACEMENT_CHARACTER) end -= 1;
  return value.slice(start, end);
}

export interface TranscriptExcerpt {
  text: string;
  elidedBytes: number;
}

/**
 * A bounded excerpt of a transcript: head, an explicit elision marker, tail.
 *
 * The tail is the larger share because a reviewer's recommendation comes last,
 * and the head is kept because a run that died on an invalid flag says so in
 * its first lines. The marker is stated rather than implied: an interpreter
 * that cannot see the whole transcript must know that, or its "no verdict
 * found" is a statement about our truncation rather than about the run.
 */
export function boundedTranscriptExcerpt(transcript: string, budgetBytes: number): TranscriptExcerpt {
  const buffer = Buffer.from(transcript, "utf8");
  if (buffer.byteLength <= budgetBytes) {
    return { text: transcript, elidedBytes: 0 };
  }
  const headBytes = Math.max(1, Math.floor(budgetBytes / 8));
  const tailBytes = Math.max(1, budgetBytes - headBytes);
  const head = trimReplacementEdges(buffer.subarray(0, headBytes).toString("utf8"));
  const tail = trimReplacementEdges(buffer.subarray(buffer.byteLength - tailBytes).toString("utf8"));
  const elidedBytes = buffer.byteLength - headBytes - tailBytes;
  return {
    text: `${head}\n[... ${elidedBytes} bytes of this transcript elided from the middle ...]\n${tail}`,
    elidedBytes,
  };
}
