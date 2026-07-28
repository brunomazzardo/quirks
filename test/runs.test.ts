// Run model: ready-task selection, dependency order, --yes approval, --dry-run
// briefs, and the no-prompt-on-pipe rule.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemblePlan, isReady, orderTasks, slugify, startRun } from "../src/ops/runs.ts";
import { proposeTask } from "../src/ops/tasks.ts";
import { createGoal } from "../src/ops/goals.ts";
import type { Store } from "../src/store/store.ts";
import type { Task } from "../src/store/types.ts";

function store(): Store {
  const dir = mkdtempSync(join(tmpdir(), "quirks-run-"));
  return { root: dir, dir: join(dir, ".quirks") };
}

function task(partial: Partial<Task> & { id: string; title: string }): Task {
  const now = new Date().toISOString();
  return {
    status: "open",
    dependsOn: [],
    deliverables: [],
    acceptanceCriteria: [],
    verification: [],
    sourceRefs: [],
    needsDesign: false,
    needsBreakdown: false,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    statusDetail: {},
    ...partial,
  };
}

describe("run ordering and readiness", () => {
  test("ready excludes future, needs-design, needs-breakdown, and non-open", () => {
    expect(isReady(task({ id: "A", title: "ok" }))).toBe(true);
    expect(isReady(task({ id: "A", title: "x", future: true }))).toBe(false);
    expect(isReady(task({ id: "A", title: "x", needsDesign: true }))).toBe(false);
    expect(isReady(task({ id: "A", title: "x", needsBreakdown: true }))).toBe(false);
    expect(isReady(task({ id: "A", title: "x", status: "claimed" }))).toBe(false);
  });

  test("orderTasks respects dependsOn and is deterministic", () => {
    const ordered = orderTasks([
      task({ id: "C", title: "c", dependsOn: ["A", "B"] }),
      task({ id: "B", title: "b", dependsOn: ["A"] }),
      task({ id: "A", title: "a" }),
    ]);
    expect(ordered.map((t) => t.id)).toEqual(["A", "B", "C"]);
  });

  test("a cycle is refused", () => {
    expect(() =>
      orderTasks([
        task({ id: "A", title: "a", dependsOn: ["B"] }),
        task({ id: "B", title: "b", dependsOn: ["A"] }),
      ]),
    ).toThrow(/cycle/);
  });

  test("slugify yields a stable report key", () => {
    expect(slugify("Native App")).toBe("native-app");
    expect(() => slugify("???")).toThrow(/slug/);
  });
});

describe("assemblePlan / startRun", () => {
  test("--goal takes ready tasks in dependency order; skips future and design", () => {
    const s = store();
    createGoal(s, { id: "QK-TST", title: "t", why: "w", doneWhen: [] });
    const a = proposeTask(s, {
      title: "first",
      goal: "QK-TST",
      dependsOn: [],
      deliverables: [],
      criteria: [],
      verify: [],
      sources: [],
      needsDesign: false,
      needsBreakdown: false,
      future: false,
    });
    const b = proposeTask(s, {
      title: "second",
      goal: "QK-TST",
      dependsOn: [a.id],
      deliverables: [],
      criteria: [],
      verify: [],
      sources: [],
      needsDesign: false,
      needsBreakdown: false,
      future: false,
    });
    proposeTask(s, {
      title: "later",
      goal: "QK-TST",
      dependsOn: [],
      deliverables: [],
      criteria: [],
      verify: [],
      sources: [],
      needsDesign: false,
      needsBreakdown: false,
      future: true,
    });
    proposeTask(s, {
      title: "vague",
      goal: "QK-TST",
      dependsOn: [],
      deliverables: [],
      criteria: [],
      verify: [],
      sources: [],
      needsDesign: true,
      needsBreakdown: false,
      future: false,
    });

    // `routable` is injected: plan routing consults the real machine, and a
    // bare assertion here would pass or fail on which CLIs are installed.
    const plan = assemblePlan(s, { name: "server work", goal: "QK-TST", routable: ["claude"] });
    expect(plan.taskIds).toEqual([a.id, b.id]);
    expect(plan.slug).toBe("server-work");
    // Routing resolves through the QK-HARN tier table; a task with no stated
    // effort is `standard`, which claude serves.
    expect(plan.plan[0]?.harness).toBe("claude");
    expect(plan.plan[0]?.model).toBe("sonnet");
    // Still null — there is no cost model, and a number would be invented.
    expect(plan.plan[0]?.estimatedCost).toBeNull();
  });

  test("no routable harness leaves every row unassigned and warns by task id", () => {
    const s = store();
    createGoal(s, { id: "QK-TST", title: "t", why: "w", doneWhen: ["done"] });
    const t = proposeTask(s, {
      title: "one", goal: "QK-TST", dependsOn: [], deliverables: [], criteria: [],
      verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
    });

    const plan = assemblePlan(s, { name: "nowhere", goal: "QK-TST", routable: [] });
    expect(plan.plan[0]?.harness).toBe("unassigned");
    expect(plan.plan[0]?.model).toBe("unassigned");
    expect(plan.warnings.some((w) => w.includes("will not dispatch") && w.includes(t.id))).toBe(true);
  });

  test("routes to the first routable harness that serves the tier", () => {
    const s = store();
    createGoal(s, { id: "QK-TST", title: "t", why: "w", doneWhen: ["done"] });
    proposeTask(s, {
      title: "one", goal: "QK-TST", dependsOn: [], deliverables: [], criteria: [],
      verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
    });

    // Claude unavailable — standard tier falls to codex, not to "unassigned".
    const plan = assemblePlan(s, { name: "codex only", goal: "QK-TST", routable: ["codex"] });
    expect(plan.plan[0]?.harness).toBe("codex");
    expect(plan.plan[0]?.model).toBe("gpt-5.5");
  });

  test("a plan warns about the harness it intends to use", () => {
    const s = store();
    createGoal(s, { id: "QK-TST", title: "t", why: "w", doneWhen: ["done"] });
    proposeTask(s, {
      title: "one", goal: "QK-TST", dependsOn: [], deliverables: [], criteria: [],
      verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
    });

    // A fresh store has no dispatch history, so claude can be `unproven` at best
    // (or `no` if it is not installed here) — either way it is never a silent yes.
    const plan = assemblePlan(s, { name: "warned", goal: "QK-TST", routable: ["claude"] });
    expect(plan.warnings.some((w) => w.startsWith("harness claude:"))).toBe(true);
  });

  test("--dry-run assembles briefs and writes nothing", () => {
    const s = store();
    createGoal(s, { id: "QK-TST", title: "t", why: "w", doneWhen: ["done"] });
    const t = proposeTask(s, {
      title: "one",
      goal: "QK-TST",
      dependsOn: [],
      deliverables: ["d"],
      criteria: ["c"],
      verify: [],
      sources: [],
      needsDesign: false,
      needsBreakdown: false,
      future: false,
    });
    const result = startRun(s, {
      name: "dry",
      taskIds: [t.id],
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    if (!result.dryRun) throw new Error("unreachable");
    expect(result.briefs).toHaveLength(1);
    expect(result.briefs[0]?.task.id).toBe(t.id);
    expect(result.briefs[0]?.goal?.doneWhen).toEqual(["done"]);
    // No durable run without --yes:
    expect(() => startRun(s, { name: "dry", taskIds: [t.id] })).toThrow(/--yes/);
  });

  test("--yes persists an approved run; duplicate active slug conflicts", () => {
    const s = store();
    const t = proposeTask(s, {
      title: "one",
      dependsOn: [],
      deliverables: [],
      criteria: [],
      verify: [],
      sources: [],
      needsDesign: false,
      needsBreakdown: false,
      future: false,
    });
    const first = startRun(s, { name: "Night Sweep", taskIds: [t.id], yes: true, mode: "autonomous" });
    expect(first.dryRun).toBe(false);
    if (first.dryRun) throw new Error("unreachable");
    expect(first.run.status).toBe("approved");
    expect(first.run.slug).toBe("night-sweep");
    expect(first.run.mode).toBe("autonomous");
    expect(first.run.taskIds).toEqual([t.id]);

    expect(() => startRun(s, { name: "Night Sweep", taskIds: [t.id], yes: true })).toThrow(/already/);
  });
});
