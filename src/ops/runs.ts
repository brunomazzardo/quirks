// Run operations — plan assembly, durable approval, dry-run briefs.
// Dispatch itself is QK-RUN-003; this module stops at the approved run record.

import { goalIdOfTask } from "../store/ids.ts";
import { loadRuns, loadTasks, saveRuns, type Store } from "../store/store.ts";
import type { Run, RunMode, RunPlanEntry, Task } from "../store/types.ts";
import { assembleBrief, type TaskBrief } from "./brief.ts";
import { ConflictError, NotFoundError, ValidationError } from "./errors.ts";

const DEFAULT_HARNESS = "unassigned";
const DEFAULT_MODEL = "unassigned";

/** A task is ready for a run when it is open work nobody has claimed, not
 *  parked as future, and not waiting on a design/breakdown flow. */
export function isReady(task: Task): boolean {
  return (
    task.status === "open" &&
    !task.future &&
    !task.needsDesign &&
    !task.needsBreakdown
  );
}

/** Topological order over dependsOn. Only edges within `tasks` count — a dep
 *  outside the set is fine (already done, or not in this run). Cycles refuse. */
export function orderTasks(tasks: Task[]): Task[] {
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
      children.get(dep)!.push(t.id);
    }
  }
  const queue = [...indegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([id]) => id)
    .sort();
  const ordered: Task[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    ordered.push(byId.get(id)!);
    for (const child of children.get(id)!.slice().sort()) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) queue.push(child);
      queue.sort();
    }
  }
  if (ordered.length !== tasks.length) {
    throw new ValidationError(
      "task dependency cycle in the run set — quirks run cannot order it",
    );
  }
  return ordered;
}

export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new ValidationError("--name must yield a slug (letters or digits)");
  return slug;
}

function mintRunId(runs: Run[]): string {
  let max = 0;
  for (const r of runs) {
    const m = /^run-(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, Number.parseInt(m[1]!, 10));
  }
  return `run-${String(max + 1).padStart(3, "0")}`;
}

function buildPlan(ordered: Task[]): RunPlanEntry[] {
  return ordered.map((t, i) => ({
    id: t.id,
    title: t.title,
    order: i + 1,
    harness: DEFAULT_HARNESS,
    model: DEFAULT_MODEL,
    estimatedCost: null,
  }));
}

export interface PlanInput {
  taskIds?: string[];
  goal?: string;
  name: string;
  mode?: RunMode;
}

export interface RunPlan {
  name: string;
  slug: string;
  goal?: string;
  mode: RunMode;
  plan: RunPlanEntry[];
  taskIds: string[];
}

/** Resolve the task set and print-ready plan. Does not write. */
export function assemblePlan(store: Store, input: PlanInput): RunPlan {
  if (!input.name?.trim()) throw new ValidationError("--name is required");
  const mode: RunMode = input.mode ?? "park-on-issue";
  if (mode !== "autonomous" && mode !== "park-on-issue") {
    throw new ValidationError(`--mode wants autonomous|park-on-issue, got ${JSON.stringify(mode)}`);
  }

  const all = loadTasks(store);
  let selected: Task[];

  if (input.goal !== undefined) {
    if (input.taskIds && input.taskIds.length > 0) {
      throw new ValidationError("pass task ids or --goal, not both");
    }
    selected = all.filter((t) => goalIdOfTask(t.id) === input.goal && isReady(t));
    if (selected.length === 0) {
      throw new ValidationError(
        `no ready tasks under goal ${input.goal} — open, not future, not needs-design/breakdown`,
      );
    }
  } else {
    const ids = input.taskIds ?? [];
    if (ids.length === 0) {
      throw new ValidationError("pass at least one task id, or --goal <id>");
    }
    selected = [];
    for (const id of ids) {
      const task = all.find((t) => t.id === id);
      if (!task) throw new NotFoundError(`no task ${id} — quirks task list shows what exists`);
      selected.push(task);
    }
  }

  const ordered = orderTasks(selected);
  const plan = buildPlan(ordered);
  const result: RunPlan = {
    name: input.name.trim(),
    slug: slugify(input.name),
    mode,
    plan,
    taskIds: ordered.map((t) => t.id),
  };
  if (input.goal !== undefined) result.goal = input.goal;
  return result;
}

export interface CreateRunInput extends PlanInput {
  /** dry-run: return plan + briefs, write nothing durable. */
  dryRun?: boolean;
  /** Required to persist an approved run when no human is confirming. */
  yes?: boolean;
}

export interface DryRunResult {
  dryRun: true;
  plan: RunPlan;
  briefs: TaskBrief[];
}

export interface ApprovedRunResult {
  dryRun: false;
  run: Run;
}

/** Assemble a plan; with dryRun print briefs and stop; with yes persist approved. */
export function startRun(store: Store, input: CreateRunInput): DryRunResult | ApprovedRunResult {
  const plan = assemblePlan(store, input);
  const tasks = loadTasks(store);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  if (input.dryRun) {
    return {
      dryRun: true,
      plan,
      briefs: plan.taskIds.map((id) => assembleBrief(store, byId.get(id)!)),
    };
  }

  if (!input.yes) {
    throw new ValidationError(
      "refusing to start a run without --yes — nothing on the execution path may prompt; pass --yes to approve the printed plan",
    );
  }

  const runs = loadRuns(store);
  if (runs.some((r) => r.slug === plan.slug && (r.status === "approved" || r.status === "running"))) {
    throw new ConflictError(
      `a run named ${JSON.stringify(plan.name)} (slug ${plan.slug}) is already ${runs.find((r) => r.slug === plan.slug)!.status} — pick another --name or resume it later`,
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
  saveRuns(store, runs);
  return { dryRun: false, run };
}

export function listRuns(store: Store): Run[] {
  return [...loadRuns(store)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getRun(store: Store, idOrSlug: string): Run {
  const run = loadRuns(store).find((r) => r.id === idOrSlug || r.slug === idOrSlug);
  if (!run) throw new NotFoundError(`no run ${idOrSlug} — quirks run list shows what exists`);
  return run;
}
