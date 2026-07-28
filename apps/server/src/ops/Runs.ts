// Run operations — plan assembly, durable approval, dry-run briefs.
// Ported from the bun-era src/ops/runs.ts (QK-MONO-003).
//
// Harness routing stays behind the `RunRouting` seam (see ops/Routing.ts): when
// QK-MONO-005 replaced the unrouted layer with the real tier/presence/liveness
// one, not a line of this file moved. Brief assembly did land here, because the
// dry-run response carries the briefs themselves.

import * as Effect from "effect/Effect";
import type { Run, RunMode, RunPlan, RunPlanEntry, RunnerKind, Task } from "@quirks/contracts";
import { goalIdOfTask } from "../store/Ids.ts";
import { Ledger, Store } from "../store/Store.ts";
import type { StoreError } from "../store/JsonFile.ts";
import { assembleBrief, type TaskBrief } from "./Brief.ts";
import { conflict, invalid, missing, type OpError } from "./Errors.ts";
import { RunRouting } from "./Routing.ts";

/**
 * Warnings printed above the `[y/N]`. Derived at approval time and deliberately
 * not persisted on the Run — they describe the machine now, and would go stale
 * the moment the run is resumed on a different day.
 */
const planWarnings = (plan: readonly RunPlanEntry[]): Effect.Effect<string[], never, RunRouting> =>
  Effect.gen(function* () {
    const routing = yield* RunRouting;
    const warnings: string[] = [];

    const unassigned = plan.filter((p) => p.harness === "unassigned");
    if (unassigned.length > 0) {
      warnings.push(
        `${unassigned.length} task(s) have no usable harness at their tier and will not dispatch: ` +
          unassigned.map((p) => p.id).join(", "),
      );
    }

    // Only complain about harnesses this plan actually intends to use.
    const used = [
      ...new Set(plan.map((p) => p.harness).filter((h) => h !== "unassigned")),
    ] as RunnerKind[];
    warnings.push(...(yield* routing.harnessWarnings(used)));
    return warnings;
  });

/** A task is ready for a run when it is open work nobody has claimed, not
 *  parked as future, and not waiting on a design/breakdown flow. */
export function isReady(task: Task): boolean {
  return task.status === "open" && !task.future && !task.needsDesign && !task.needsBreakdown;
}

/** Topological order over dependsOn. Only edges within `tasks` count — a dep
 *  outside the set is fine (already done, or not in this run). Cycles refuse. */
export const orderTasks = (tasks: readonly Task[]): Effect.Effect<Task[], OpError> =>
  Effect.gen(function* () {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const indegree = new Map<string, number>();
    const children = new Map<string, string[]>();
    for (const t of tasks) {
      indegree.set(t.id, 0);
      children.set(t.id, []);
    }
    for (const t of tasks) {
      for (const dep of t.dependsOn) {
        if (!byId.has(dep)) continue;
        indegree.set(t.id, (indegree.get(t.id) ?? 0) + 1);
        children.get(dep)?.push(t.id);
      }
    }
    const queue = [...indegree.entries()]
      .filter(([, d]) => d === 0)
      .map(([id]) => id)
      .sort();
    const ordered: Task[] = [];
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) break;
      const task = byId.get(id);
      if (task) ordered.push(task);
      for (const child of (children.get(id) ?? []).slice().sort()) {
        const next = (indegree.get(child) ?? 0) - 1;
        indegree.set(child, next);
        if (next === 0) queue.push(child);
        queue.sort();
      }
    }
    if (ordered.length !== tasks.length) {
      return yield* invalid("task dependency cycle in the run set — quirks run cannot order it");
    }
    return ordered;
  });

export const slugify = (name: string): Effect.Effect<string, OpError> => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return invalid("--name must yield a slug (letters or digits)");
  return Effect.succeed(slug);
};

function mintRunId(runs: readonly Run[]): string {
  let max = 0;
  for (const r of runs) {
    const m = /^run-(\d+)$/.exec(r.id);
    if (m?.[1] !== undefined) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  return `run-${String(max + 1).padStart(3, "0")}`;
}

const buildPlan = (
  ordered: readonly Task[],
  routable: readonly RunnerKind[],
): Effect.Effect<RunPlanEntry[], never, RunRouting> =>
  Effect.gen(function* () {
    const routing = yield* RunRouting;
    return ordered.map((t, i) => {
      const routed = routing.routeTask(t, routable);
      return {
        id: t.id,
        title: t.title,
        order: i + 1,
        harness: routed.harness,
        model: routed.model,
        // Still null: no cost model exists, and inventing a number is worse than
        // admitting we do not have one.
        estimatedCost: null,
      };
    });
  });

export interface PlanInput {
  readonly taskIds?: string[] | undefined;
  readonly goal?: string | undefined;
  readonly name: string;
  readonly mode?: RunMode | undefined;
  /** Override the machine's routable set. Tests inject a fixed list so a plan
   *  assertion does not depend on which CLIs the developer happens to have. */
  readonly routable?: readonly RunnerKind[] | undefined;
}

/** Resolve the task set and print-ready plan. Does not write. */
export const assemblePlan = (
  input: PlanInput,
): Effect.Effect<RunPlan, StoreError | OpError, Ledger | RunRouting> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const routing = yield* RunRouting;

    if (!input.name?.trim()) return yield* invalid("--name is required");
    const mode: RunMode = input.mode ?? "park-on-issue";
    if (mode !== "autonomous" && mode !== "park-on-issue") {
      return yield* invalid(`--mode wants autonomous|park-on-issue, got ${JSON.stringify(mode)}`);
    }

    const all = yield* ledger.loadTasks;
    let selected: Task[];

    if (input.goal !== undefined) {
      if (input.taskIds && input.taskIds.length > 0) {
        return yield* invalid("pass task ids or --goal, not both");
      }
      selected = all.filter((t) => goalIdOfTask(t.id) === input.goal && isReady(t));
      if (selected.length === 0) {
        return yield* invalid(
          `no ready tasks under goal ${input.goal} — open, not future, not needs-design/breakdown`,
        );
      }
    } else {
      const ids = input.taskIds ?? [];
      if (ids.length === 0) {
        return yield* invalid("pass at least one task id, or --goal <id>");
      }
      selected = [];
      for (const id of ids) {
        const task = all.find((t) => t.id === id);
        if (!task) return yield* missing(`no task ${id} — quirks task list shows what exists`);
        selected.push(task);
      }
    }

    const ordered = yield* orderTasks(selected);
    const effective = input.routable ?? (yield* routing.routable);
    const plan = yield* buildPlan(ordered, effective);
    const result: RunPlan = {
      name: input.name.trim(),
      slug: yield* slugify(input.name),
      mode,
      plan,
      taskIds: ordered.map((t) => t.id),
      warnings: yield* planWarnings(plan),
      ...(input.goal !== undefined ? { goal: input.goal } : {}),
    };
    return result;
  });

export interface CreateRunInput extends PlanInput {
  /** dry-run: return plan + briefs, write nothing durable. */
  readonly dryRun?: boolean | undefined;
  /** Required to persist an approved run when no human is confirming. */
  readonly yes?: boolean | undefined;
}

export interface DryRunResult {
  readonly dryRun: true;
  readonly plan: RunPlan;
  /** One brief per planned task, in execution order — the facts the agent would
   *  actually be handed, including each sourceRef's pin→HEAD diff. `briefsPending`
   *  is gone from this response now that there is nothing pending. */
  readonly briefs: TaskBrief[];
}

export interface ApprovedRunResult {
  readonly dryRun: false;
  readonly run: Run;
}

/** Assemble a plan; with dryRun return the plan and stop; with yes persist approved. */
export const startRun = (
  input: CreateRunInput,
): Effect.Effect<
  DryRunResult | ApprovedRunResult,
  StoreError | OpError,
  Ledger | Store | RunRouting
> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const plan = yield* assemblePlan(input);

    if (input.dryRun) {
      const byId = new Map((yield* ledger.loadTasks).map((t) => [t.id, t]));
      const planned = plan.taskIds.flatMap((id) => {
        const task = byId.get(id);
        return task ? [task] : [];
      });
      return {
        dryRun: true,
        plan,
        briefs: yield* Effect.forEach(planned, (task) => assembleBrief(task)),
      };
    }

    if (!input.yes) {
      return yield* invalid(
        "refusing to start a run without --yes — nothing on the execution path may prompt; pass --yes to approve the printed plan",
      );
    }

    const runs = yield* ledger.loadRuns;
    const active = runs.find(
      (r) => r.slug === plan.slug && (r.status === "approved" || r.status === "running"),
    );
    if (active) {
      return yield* conflict(
        `a run named ${JSON.stringify(plan.name)} (slug ${plan.slug}) is already ${active.status} — pick another --name or resume it later`,
      );
    }

    const now = new Date().toISOString();
    const run: Run = {
      id: mintRunId(runs),
      name: plan.name,
      slug: plan.slug,
      ...(plan.goal !== undefined ? { goal: plan.goal } : {}),
      mode: plan.mode,
      status: "approved",
      taskIds: plan.taskIds,
      plan: plan.plan,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
    };
    runs.push(run);
    yield* ledger.saveRuns(runs);
    return { dryRun: false, run };
  });

export const listRuns: Effect.Effect<Run[], StoreError, Ledger> = Effect.gen(function* () {
  const ledger = yield* Ledger;
  return [...(yield* ledger.loadRuns)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
});

export const getRun = (idOrSlug: string): Effect.Effect<Run, StoreError | OpError, Ledger> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const run = (yield* ledger.loadRuns).find((r) => r.id === idOrSlug || r.slug === idOrSlug);
    if (!run) return yield* missing(`no run ${idOrSlug} — quirks run list shows what exists`);
    return run;
  });

/** Runs the ledger believes are executing. A corrupt runs file is not evidence
 *  that nothing is running — refuse to claim the coast is clear. */
export const runsInFlight: Effect.Effect<string[], never, Ledger> = Effect.gen(function* () {
  const ledger = yield* Ledger;
  return yield* ledger.loadRuns.pipe(
    Effect.map((runs) => runs.filter((r) => r.status === "running").map((r) => r.id)),
    Effect.orElseSucceed(() => ["<unreadable runs record>"]),
  );
});
