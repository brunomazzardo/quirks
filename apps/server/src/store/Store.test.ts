// Ledger shape validation. The carried defect again, one level up: valid JSON of
// the wrong shape, or a row with no usable status, is corruption — not an empty
// ledger, and not a row to skip past.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { StoreCorruptError } from "./JsonFile.ts";
import { Ledger } from "./Store.ts";
import { runOp, runOpError, tempRoot } from "../testing/Harness.ts";

const loadTasks = Effect.flatMap(Ledger, (ledger) => ledger.loadTasks);
const loadGoals = Effect.flatMap(Ledger, (ledger) => ledger.loadGoals);
const loadRuns = Effect.flatMap(Ledger, (ledger) => ledger.loadRuns);

function seed(contents: string, file = "tasks.json"): string {
  const root = tempRoot();
  mkdirSync(join(root, ".quirks"), { recursive: true });
  writeFileSync(join(root, ".quirks", file), contents);
  return root;
}

describe("ledger shape validation", () => {
  it("absent store is an empty task list", async () => {
    expect(await runOp(tempRoot(), loadTasks)).toEqual([]);
  });

  it("valid JSON of the wrong shape is corrupt, not empty", async () => {
    const root = seed(JSON.stringify({ version: 99, other: [] }));
    const error = await runOpError(root, loadTasks);
    expect(error).toBeInstanceOf(StoreCorruptError);
    expect(error.message).toContain("not a version-1 tasks file");
  });

  it("a task without a valid status is corrupt, not skipped", async () => {
    const root = seed(JSON.stringify({ version: 1, tasks: [{ id: "QK-001", status: "banana" }] }));
    const error = await runOpError(root, loadTasks);
    expect(error).toBeInstanceOf(StoreCorruptError);
    expect(error.message).toContain("QK-001");
  });

  it("a goal without a valid state is corrupt", async () => {
    const root = seed(
      JSON.stringify({ version: 1, goals: [{ id: "QK-TST", state: "vibes" }] }),
      "goals.json",
    );
    const error = await runOpError(root, loadGoals);
    expect(error).toBeInstanceOf(StoreCorruptError);
    expect(error.message).toContain("QK-TST");
  });

  it("a run without a valid mode is corrupt", async () => {
    const root = seed(
      JSON.stringify({ version: 1, runs: [{ id: "run-001", status: "approved", mode: "vibes" }] }),
      "runs.json",
    );
    const error = await runOpError(root, loadRuns);
    expect(error).toBeInstanceOf(StoreCorruptError);
    expect(error.message).toContain("run-001");
  });

  it("writes land atomically: no .tmp file is left behind", async () => {
    const root = tempRoot();
    await runOp(
      root,
      Effect.flatMap(Ledger, (ledger) => ledger.saveTasks([])),
    );
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(join(root, ".quirks"))).toEqual(["tasks.json"]);
  });
});
