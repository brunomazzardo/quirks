import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeJsonAtomic } from "../../src/state/atomic-file.js";

test("creates parent directories and writes canonical JSON with a trailing newline", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-atomic-"));
  const file = path.join(dir, "nested", "data.json");
  await writeJsonAtomic(file, { z: 1, a: true });
  assert.equal(await readFile(file, "utf8"), '{"a":true,"z":1}\n');
});

test("atomically replaces an existing JSON file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quirks-atomic-"));
  const file = path.join(dir, "data.json");
  await writeJsonAtomic(file, { version: 1 });
  await writeJsonAtomic(file, { version: 2 });
  assert.equal(await readFile(file, "utf8"), '{"version":2}\n');
});
