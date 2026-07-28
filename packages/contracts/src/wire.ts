// The /v1 HTTP surface — request and response shapes as the bun-era service
// (src/service/app.ts) actually serves them (QK-MONO-002). The Effect service
// (QK-MONO-003) takes over as the one authority; until then this file mirrors,
// never leads. Paginated JSON on the wire is D6.

import type {
  Goal,
  Run,
  RunMode,
  RunPlanEntry,
  Task,
} from "./domain.ts";

/** Every list route pages: `?offset=&limit=` (default limit 100). */
export interface Page<T> {
  total: number;
  offset: number;
  limit: number;
  items: T[];
}

/** Non-2xx bodies: 400 validation, 404 not found, 409 conflict/transition,
 *  500 store corruption. */
export interface WireError {
  error: string;
}

// ---- goals ----

/** One row of GET /v1/goals — the founding doc's union: recorded goals, goals
 *  implied by task-id prefixes, and the bare-number namespace when it has tasks. */
export interface GoalRollup {
  id: string;
  title: string | null;
  recorded: boolean;
  state: string;
  total: number;
  done: number;
  open: number;
  blocked: number;
  future: number;
}

/** GET /v1/goals?all=true includes done and abandoned rows. */
export type GoalListResponse = Page<GoalRollup>;

/** POST /v1/goals */
export interface GoalCreateBody {
  id: string;
  title: string;
  why?: string;
  whyRef?: string;
  doneWhen?: string[];
}

/** POST /v1/goals/:id/done and /v1/goals/:id/abandon — reason is required;
 *  a goal leaving active with no reason is how a ledger starts lying. */
export interface GoalLeaveActiveBody {
  reason: string;
}

/** GET /v1/goals/:id */
export interface GoalDetail {
  goal: Goal;
  tasks: Task[];
}

// ---- tasks ----

/** GET /v1/tasks query — plus offset/limit. */
export interface TaskListQuery {
  goal?: string;
  status?: string;
}

export type TaskListResponse = Page<Task>;

/** POST /v1/tasks */
export interface TaskProposeBody {
  title: string;
  goal?: string;
  dependsOn?: string[];
  deliverables?: string[];
  criteria?: string[];
  verify?: string[];
  sources?: string[];
  effort?: string;
  risk?: string;
  needsDesign?: boolean;
  needsBreakdown?: boolean;
  future?: boolean;
}

/** POST /v1/tasks/:id/claim */
export interface TaskClaimBody {
  by?: string;
  force?: boolean;
  ifRevision?: number;
}

/** POST /v1/tasks/:id/block */
export interface TaskBlockBody {
  reason: string;
  until?: string;
  ifRevision?: number;
}

/** POST /v1/tasks/:id/complete */
export interface TaskCompleteBody {
  evidence?: string;
  ifRevision?: number;
}

/** POST /v1/tasks/:id/release */
export interface TaskReleaseBody {
  ifRevision?: number;
}

// ---- runs ----

/** POST /v1/runs/plan */
export interface RunPlanBody {
  name: string;
  goal?: string;
  mode?: RunMode;
  taskIds?: string[];
}

/** The print-ready plan — the whole approval surface. */
export interface RunPlan {
  name: string;
  slug: string;
  goal?: string;
  mode: RunMode;
  plan: RunPlanEntry[];
  taskIds: string[];
  /** Shown before approval. Empty when every row lands on a proven harness. */
  warnings: string[];
}

/** POST /v1/runs */
export interface RunStartBody extends RunPlanBody {
  /** dry-run: return plan + briefs, write nothing durable. */
  dryRun?: boolean;
  /** Required to persist an approved run when no human is confirming. */
  yes?: boolean;
}

export interface RunStartDryResponse {
  dryRun: true;
  plan: RunPlan;
  /** The brief is being reshaped into a rendered Markdown document (S11);
   *  its wire type lands with the Effect service (QK-MONO-003/005). */
  briefs: unknown[];
}

export interface RunStartApprovedResponse {
  dryRun: false;
  run: Run;
}

export type RunStartResponse = RunStartDryResponse | RunStartApprovedResponse;

export type RunListResponse = Page<Run>;

/** POST /v1/runs/:id/execute and /v1/runs/:id/resume. */
export interface RunExecuteBody {
  implementerModel?: string;
  reviewerModel?: string;
  review?: boolean;
  timeoutMs?: number;
}

// ---- harness ----

/** GET /v1/harness?probe=true&timeoutMs=… — the row/tier/review web lives in
 *  the ops layer; its wire type is finalized when the honesty machinery ports
 *  (QK-MONO-005). Until then consumers treat the body as opaque. */
export type HarnessViewResponse = unknown;

// ---- shape companion ----

/** POST /v1/shape/ensure */
export interface ShapeEnsureResponse {
  url: string;
  screen_dir: string;
  state_dir: string;
  session_dir: string;
}

/** POST /v1/shape/end */
export interface ShapeEndResponse {
  status: "ended";
}

/** GET /v1/shape/events — free-form choice events recorded from the companion. */
export interface ShapeEventsResponse {
  events: unknown[];
}

/** POST /v1/shape/screens */
export interface ShapeScreenBody {
  name: string;
  html: string;
}
