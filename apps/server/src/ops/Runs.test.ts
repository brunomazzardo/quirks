// Run model: ready-task selection, dependency order, --yes approval, --dry-run,
// and the no-prompt-on-pipe rule.
import type { Task } from "@quirks/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { createGoal } from "./Goals.ts";
import { proposeTask, type ProposeInput } from "./Tasks.ts";
import { assemblePlan, isReady, orderTasks, slugify, startRun } from "./Runs.ts";
import { runOp, runOpError, stubRouting, tempRoot } from "../testing/Harness.ts";

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

const propose = (overrides: Partial<ProposeInput> & { title: string }): ProposeInput => ({
  dependsOn: [],
  deliverables: [],
  criteria: [],
  verify: [],
  sources: [],
  needsDesign: false,
  needsBreakdown: false,
  future: false,
  ...overrides,
});

describe("run ordering and readiness", () => {
  it("ready excludes future, needs-design, needs-breakdown, and non-open", () => {
    expect(isReady(task({ id: "A", title: "ok" }))).toBe(true);
    expect(isReady(task({ id: "A", title: "x", future: true }))).toBe(false);
    expect(isReady(task({ id: "A", title: "x", needsDesign: true }))).toBe(false);
    expect(isReady(task({ id: "A", title: "x", needsBreakdown: true }))).toBe(false);
    expect(isReady(task({ id: "A", title: "x", status: "claimed" }))).toBe(false);
  });

  it("orderTasks respects dependsOn and is deterministic", () => {
    const ordered = Effect.runSync(
      orderTasks([
        task({ id: "C", title: "c", dependsOn: ["A", "B"] }),
        task({ id: "B", title: "b", dependsOn: ["A"] }),
        task({ id: "A", title: "a" }),
      ]),
    );
    expect(ordered.map((t) => t.id)).toEqual(["A", "B", "C"]);
  });

  it("a cycle is refused", () => {
    const error = Effect.runSync(
      Effect.flip(
        orderTasks([
          task({ id: "A", title: "a", dependsOn: ["B"] }),
          task({ id: "B", title: "b", dependsOn: ["A"] }),
        ]),
      ),
    );
    expect(error.message).toMatch(/cycle/);
  });

  it("slugify yields a stable report key", () => {
    expect(Effect.runSync(slugify("Native App"))).toBe("native-app");
    expect(Effect.runSync(Effect.flip(slugify("???"))).message).toMatch(/slug/);
  });
});

describe("assemblePlan / startRun", () => {
  it("--goal takes ready tasks in dependency order; skips future and design", async () => {
    const root = tempRoot("quirks-run-");
    const plan = await runOp(
      root,
      Effect.gen(function* () {
        yield* createGoal({ id: "QK-TST", title: "t", why: "w", doneWhen: [] });
        const a = yield* proposeTask(propose({ title: "first", goal: "QK-TST" }));
        const b = yield* proposeTask(
          propose({ title: "second", goal: "QK-TST", dependsOn: [a.id] }),
        );
        yield* proposeTask(propose({ title: "later", goal: "QK-TST", future: true }));
        yield* proposeTask(propose({ title: "vague", goal: "QK-TST", needsDesign: true }));
        const assembled = yield* assemblePlan({
          name: "server work",
          goal: "QK-TST",
          routable: ["claude"],
        });
        return { assembled, ids: [a.id, b.id] };
      }),
      stubRouting(["claude"]),
    );

    expect(plan.assembled.taskIds).toEqual(plan.ids);
    expect(plan.assembled.slug).toBe("server-work");
    expect(plan.assembled.plan[0]?.harness).toBe("claude");
    expect(plan.assembled.plan[0]?.model).toBe("sonnet");
    // Still null — there is no cost model, and a number would be invented.
    expect(plan.assembled.plan[0]?.estimatedCost).toBeNull();
  });

  it("no routable harness leaves every row unassigned and warns by task id", async () => {
    const root = tempRoot("quirks-run-");
    const result = await runOp(
      root,
      Effect.gen(function* () {
        yield* createGoal({ id: "QK-TST", title: "t", why: "w", doneWhen: ["done"] });
        const t = yield* proposeTask(propose({ title: "one", goal: "QK-TST" }));
        const plan = yield* assemblePlan({ name: "nowhere", goal: "QK-TST", routable: [] });
        return { plan, id: t.id };
      }),
      stubRouting([]),
    );
    expect(result.plan.plan[0]?.harness).toBe("unassigned");
    expect(result.plan.plan[0]?.model).toBe("unassigned");
    expect(
      result.plan.warnings.some((w) => w.includes("will not dispatch") && w.includes(result.id)),
    ).toBe(true);
  });

  it("routes to the first routable harness that serves the tier", async () => {
    const root = tempRoot("quirks-run-");
    const plan = await runOp(
      root,
      Effect.gen(function* () {
        yield* createGoal({ id: "QK-TST", title: "t", why: "w", doneWhen: ["done"] });
        yield* proposeTask(propose({ title: "one", goal: "QK-TST" }));
        // Claude unavailable — the plan falls to codex, not to "unassigned".
        return yield* assemblePlan({ name: "codex only", goal: "QK-TST", routable: ["codex"] });
      }),
      stubRouting(["codex"]),
    );
    expect(plan.plan[0]?.harness).toBe("codex");
    expect(plan.plan[0]?.model).toBe("gpt-5.5");
  });

  it("a plan warns about the harness it intends to use", async () => {
    const root = tempRoot("quirks-run-");
    const plan = await runOp(
      root,
      Effect.gen(function* () {
        yield* createGoal({ id: "QK-TST", title: "t", why: "w", doneWhen: ["done"] });
        yield* proposeTask(propose({ title: "one", goal: "QK-TST" }));
        return yield* assemblePlan({ name: "warned", goal: "QK-TST", routable: ["claude"] });
      }),
      stubRouting(["claude"]),
    );
    expect(plan.warnings.some((w) => w.startsWith("harness claude:"))).toBe(true);
  });

  it("the default routing layer admits it cannot route, rather than guessing", async () => {
    const root = tempRoot("quirks-run-");
    const plan = await runOp(
      root,
      Effect.gen(function* () {
        yield* createGoal({ id: "QK-TST", title: "t", why: "w", doneWhen: ["done"] });
        yield* proposeTask(propose({ title: "one", goal: "QK-TST" }));
        return yield* assemblePlan({ name: "unrouted", goal: "QK-TST" });
      }),
    );
    expect(plan.plan[0]?.harness).toBe("unassigned");
    expect(plan.warnings.some((w) => w.includes("QK-MONO-005"))).toBe(true);
  });

  it("--dry-run writes nothing, and carries the brief each task would be handed", async () => {
    const root = tempRoot("quirks-run-");
    const result = await runOp(
      root,
      Effect.gen(function* () {
        yield* createGoal({ id: "QK-TST", title: "t", why: "w", doneWhen: ["done"] });
        const t = yield* proposeTask(
          propose({ title: "one", goal: "QK-TST", deliverables: ["d"], criteria: ["c"] }),
        );
        return yield* startRun({ name: "dry", taskIds: [t.id], dryRun: true });
      }),
    );
    expect(result.dryRun).toBe(true);
    if (result.dryRun !== true) throw new Error("unreachable");
    // Brief assembly landed in QK-MONO-005: one brief per planned task, in plan
    // order, and `briefsPending` is gone because nothing is pending.
    expect(result.briefs).toHaveLength(1);
    expect(result.briefs[0]?.task.id).toBe(result.plan.taskIds[0]);
    expect(result.briefs[0]?.task.deliverables).toEqual(["d"]);
    expect(result.briefs[0]?.goal?.doneWhen).toEqual(["done"]);
    expect(result.briefs[0]?.instructionsHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect("briefsPending" in result).toBe(false);
  });

  it("no durable run without --yes", async () => {
    const root = tempRoot("quirks-run-");
    const error = await runOpError(
      root,
      Effect.gen(function* () {
        const t = yield* proposeTask(propose({ title: "one" }));
        return yield* startRun({ name: "dry", taskIds: [t.id] });
      }),
    );
    expect(error.message).toMatch(/--yes/);
  });

  it("--yes persists an approved run; duplicate active slug conflicts", async () => {
    const root = tempRoot("quirks-run-");
    const first = await runOp(
      root,
      Effect.gen(function* () {
        const t = yield* proposeTask(propose({ title: "one" }));
        const started = yield* startRun({
          name: "Night Sweep",
          taskIds: [t.id],
          yes: true,
          mode: "autonomous",
        });
        return { started, id: t.id };
      }),
    );
    expect(first.started.dryRun).toBe(false);
    if (first.started.dryRun !== false) throw new Error("unreachable");
    expect(first.started.run.status).toBe("approved");
    expect(first.started.run.slug).toBe("night-sweep");
    expect(first.started.run.mode).toBe("autonomous");
    expect(first.started.run.taskIds).toEqual([first.id]);

    const conflict = await runOpError(
      root,
      startRun({ name: "Night Sweep", taskIds: [first.id], yes: true }),
    );
    expect(conflict.message).toMatch(/already/);
  });
});
