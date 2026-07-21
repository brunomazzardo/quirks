import assert from "node:assert/strict";
import { appendFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { QuirksError } from "../../src/core/errors.js";
import { EventJournal } from "../../src/state/event-journal.js";

const sampleEvent = {
  schemaVersion: 1 as const,
  id: "evt-1",
  type: "created",
  at: "2026-07-21T00:00:00.000Z",
  data: {},
};

test("journal appends framed events and rejects a torn final frame", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-journal-"));
  const journalPath = path.join(dir, "events.jsonl");
  const journal = new EventJournal(journalPath);
  await journal.append(sampleEvent);
  assert.deepEqual(await journal.read(), [sampleEvent]);

  await appendFile(journalPath, '{"schemaVersion":1,"id":"evt-2","typ');
  await assert.rejects(
    () => journal.read(),
    (error: unknown) => error instanceof QuirksError && error.code === "PROTOCOL_VIOLATION",
  );
});

test("rejects newline-containing event fields on append", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-journal-"));
  const journal = new EventJournal(path.join(dir, "events.jsonl"));
  await assert.rejects(
    () => journal.append({ ...sampleEvent, id: "evt-bad\nline" }),
    (error: unknown) => error instanceof QuirksError && error.code === "PROTOCOL_VIOLATION",
  );
});
