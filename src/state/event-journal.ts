import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "../core/canonical-json.js";
import { QuirksError } from "../core/errors.js";
import type { JournalEvent } from "./types.js";

function containsNewline(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\n");
  if (Array.isArray(value)) return value.some(containsNewline);
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(containsNewline);
  }
  return false;
}

function assertJournalEvent(value: unknown): JournalEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Journal event must be an object");
  }

  const event = value as Record<string, unknown>;
  if (event["schemaVersion"] !== 1) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Journal event schemaVersion must be 1");
  }
  for (const field of ["id", "type", "at"] as const) {
    if (typeof event[field] !== "string" || event[field].length === 0) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Journal event field ${field} must be a non-empty string`);
    }
  }
  if (event["data"] === null || typeof event["data"] !== "object" || Array.isArray(event["data"])) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Journal event data must be an object");
  }

  if (containsNewline(event)) {
    throw new QuirksError("PROTOCOL_VIOLATION", "Journal event strings must not contain newlines");
  }

  return {
    schemaVersion: 1,
    id: event["id"] as string,
    type: event["type"] as string,
    at: event["at"] as string,
    data: event["data"] as Record<string, unknown>,
  };
}

function parseJournalLine(line: string, lineNumber: number): JournalEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new QuirksError("PROTOCOL_VIOLATION", `Malformed journal frame at line ${lineNumber}`);
  }
  return assertJournalEvent(parsed);
}

export class EventJournal {
  constructor(readonly filePath: string) {}

  async append(event: JournalEvent): Promise<void> {
    const validated = assertJournalEvent(event);
    const frame = canonicalJson(validated);
    if (frame.includes("\n")) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Journal frame must be a single line");
    }

    await mkdir(path.dirname(this.filePath), { recursive: true });
    const handle = await open(this.filePath, "a", 0o600);
    try {
      await handle.write(`${frame}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async read(): Promise<JournalEvent[]> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }

    if (contents.length === 0) return [];

    const lines = contents.split("\n");
    const hasTrailingNewline = contents.endsWith("\n");
    const events: JournalEvent[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const isLastLine = index === lines.length - 1;
      if (line.length === 0) {
        if (!isLastLine || hasTrailingNewline) continue;
        throw new QuirksError("PROTOCOL_VIOLATION", `Malformed journal frame at line ${index + 1}`);
      }
      events.push(parseJournalLine(line, index + 1));
    }

    return events;
  }
}
