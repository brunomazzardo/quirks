import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createContextualFixture,
  FEATURE_TASK_ID,
  materializeContextualPromptFeature,
  PLAN_PATH,
  PLAN_TASK_NUMBERS,
  SPEC_PATH,
} from "./support/contextual-fixture.js";

test("a committed plan becomes one durable task through TaskSource authority", async () => {
  const fixture = await createContextualFixture();
  try {
    const task = await materializeContextualPromptFeature(fixture);
    assert.equal(task.id, FEATURE_TASK_ID);
    const planTaskNumbers = task.sourceRefs
      .filter((ref) => ref.kind === "plan")
      .map((ref) => ref.task);
    assert.deepEqual(planTaskNumbers, [...PLAN_TASK_NUMBERS]);
    assert.equal(
      task.sourceRefs.every((ref) => ref.kind !== "plan" || ref.commit === fixture.planCommit),
      true,
      "plan refs are pinned to the exact plan commit",
    );

    const shown = await fixture.source.execute({
      schemaVersion: 1,
      operation: "show",
      taskId: FEATURE_TASK_ID,
      input: {},
    });
    assert.equal(shown.ok, true);
    if (!shown.ok) return;
    const data = shown.data as {
      status: string;
      sourceRefs: readonly { kind: string; path: string; commit: string; task?: number }[];
    };
    assert.equal(data.status, "ready");
    assert.equal(data.sourceRefs.filter((ref) => ref.kind === "plan").length, PLAN_TASK_NUMBERS.length);
    assert.deepEqual(
      data.sourceRefs.find((ref) => ref.kind === "spec"),
      { kind: "spec", path: SPEC_PATH, commit: fixture.planCommit },
    );

    const raw = JSON.parse(await readFile(path.join(fixture.root, ".quirks/tasks.json"), "utf8")) as {
      tasks: { id: string; sourceRefs: readonly { path?: string }[] }[];
    };
    assert.equal(raw.tasks.length, 1);
    assert.equal(raw.tasks[0]!.id, FEATURE_TASK_ID);
    const persistedPlanRefs = raw.tasks[0]!.sourceRefs.filter((ref) => ref.path === PLAN_PATH);
    assert.equal(persistedPlanRefs.length, PLAN_TASK_NUMBERS.length, "plan bodies are never copied into the record");
  } finally {
    await fixture.dispose();
  }
});

test("repeated materialization replays idempotently instead of duplicating tasks", async () => {
  const fixture = await createContextualFixture();
  try {
    const first = await materializeContextualPromptFeature(fixture);
    const second = await materializeContextualPromptFeature(fixture);
    assert.equal(second.id, first.id);
    assert.deepEqual(second.sourceRefs, first.sourceRefs);

    const raw = JSON.parse(await readFile(path.join(fixture.root, ".quirks/tasks.json"), "utf8")) as {
      tasks: unknown[];
    };
    assert.equal(raw.tasks.length, 1);
  } finally {
    await fixture.dispose();
  }
});
