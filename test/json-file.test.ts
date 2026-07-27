import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ABSENT, loadJsonFile, saveJsonFile, StoreCorruptError } from "../src/store/json-file.ts";
import { loadTasks, openStore } from "../src/store/store.ts";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "quirks-test-"));
}

describe("loadJsonFile", () => {
  test("absent is a normal outcome, not an error", () => {
    expect(loadJsonFile(join(dir(), "nope.json"))).toBe(ABSENT);
  });

  test("roundtrips through saveJsonFile", () => {
    const path = join(dir(), "a", "b", "data.json");
    saveJsonFile(path, { version: 1, tasks: [] });
    expect(loadJsonFile(path)).toEqual({ version: 1, tasks: [] });
  });

  test("corrupt JSON throws, never reads as empty", () => {
    const path = join(dir(), "tasks.json");
    writeFileSync(path, "{ definitely not json");
    expect(() => loadJsonFile(path)).toThrow(StoreCorruptError);
    expect(() => loadJsonFile(path)).toThrow(path);
  });

  test("no temp files survive a save", () => {
    const d = dir();
    const path = join(d, "data.json");
    saveJsonFile(path, { ok: true });
    expect(readdirSync(d)).toEqual(["data.json"]);
  });
});

describe("loadTasks shape validation", () => {
  test("valid JSON of the wrong shape is corrupt, not empty", () => {
    const d = dir();
    writeFileSync(join(d, ".quirks-placeholder"), "");
    const store = { root: d, dir: d };
    writeFileSync(join(d, "tasks.json"), JSON.stringify({ version: 99, other: [] }));
    expect(() => loadTasks(store)).toThrow(StoreCorruptError);
  });

  test("a task without a valid status is corrupt, not skipped", () => {
    const d = dir();
    const store = { root: d, dir: d };
    writeFileSync(
      join(d, "tasks.json"),
      JSON.stringify({ version: 1, tasks: [{ id: "QK-001", status: "banana" }] }),
    );
    expect(() => loadTasks(store)).toThrow(StoreCorruptError);
  });

  test("absent store is an empty task list", () => {
    const store = openStore(dir());
    expect(loadTasks(store)).toEqual([]);
  });
});
