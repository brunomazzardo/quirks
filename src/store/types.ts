// The domain shapes the store persists. When the service arrives (bootstrap step 4)
// these become the seed of @quirks/wire; until then they are the store's contract.

export type TaskStatus = "open" | "claimed" | "blocked" | "completed";

/** A pointer to a document plus the commit it was read at — the baseline that
 *  makes "this changed" computable. Null when the repo has no commits. */
export interface SourceRef {
  path: string;
  pinnedCommit: string | null;
}

/** State baggage for the current status. Cleared or restored by transitions,
 *  never written directly by the operator. */
export interface StatusDetail {
  blockedReason?: string;
  blockedUntil?: string;
  /** What `blocked` interrupted, so `release` restores rather than guesses. */
  priorStatus?: TaskStatus;
  claimedBy?: string;
  evidence?: string;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  dependsOn: string[];
  deliverables: string[];
  acceptanceCriteria: string[];
  verification: string[];
  sourceRefs: SourceRef[];
  needsDesign: boolean;
  needsBreakdown: boolean;
  /** Deliberately not now — distinct from blocked (cannot proceed). Advisory:
   *  excluded from open counts, but nothing stops claiming it. */
  future?: boolean;
  effort?: string;
  risk?: string;
  /** Bumped on every write. The CLI derives concurrency checks from it;
   *  it is never the operator's job. */
  revision: number;
  createdAt: string;
  updatedAt: string;
  statusDetail: StatusDetail;
}

export type GoalState = "active" | "done" | "abandoned";

export interface GoalWhy {
  text?: string;
  ref?: SourceRef;
}

export interface Goal {
  /** The task-id prefix, e.g. QK-SRV. Member tasks are always derived from it. */
  id: string;
  title: string;
  /** A sentence and/or a pointer to the spec — never a copied body. */
  why: GoalWhy;
  /** Asserted criteria. Every member task can complete while the thing is not built. */
  doneWhen: string[];
  state: GoalState;
  /** Required whenever state leaves `active`. */
  stateReason?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface TasksFile {
  version: 1;
  tasks: Task[];
}

export interface GoalsFile {
  version: 1;
  goals: Goal[];
}

/** Autonomy policy for a run — chosen once at `quirks run` time. */
export type RunMode = "autonomous" | "park-on-issue";

/** Lifecycle of a run. `planned` is dry-run / planner only; `approved` is
 *  durable after `--yes` (or a TTY [y/N]); dispatch lands in QK-RUN-003. */
export type RunStatus = "planned" | "approved" | "running" | "completed" | "abandoned";

/** One row of the plan printed before approval — the whole approval surface. */
export interface RunPlanEntry {
  id: string;
  title: string;
  order: number;
  /** Unassigned until QK-HARN-001 / routing exists. */
  harness: string;
  model: string;
  /** Null means unknown — never invent a number. */
  estimatedCost: number | null;
}

export interface Run {
  id: string;
  name: string;
  /** Derived from `--name`; `quirks report <slug>` resolves through this. */
  slug: string;
  goal?: string;
  mode: RunMode;
  status: RunStatus;
  /** Task ids in execution (dependency) order. */
  taskIds: string[];
  plan: RunPlanEntry[];
  /** Filled once execution starts (QK-RUN-005). */
  tasks?: RunTaskRecord[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export type RunTaskOutcome =
  | "pending"
  | "running"
  | "accepted"
  | "partial"
  | "failed"
  | "blocked"
  | "held"
  | "released";

/** One runner invocation, as it actually happened. `quirks harness` derives
 *  liveness from the newest of these per runner, and `quirks report` reads them
 *  for the per-task story — so this is where "did codex answer tonight" lives.
 *  Never a judgment of the work: that is `verdict`. */
export interface RunDispatchRecord {
  runner: "claude" | "codex" | "cursor";
  role: "implementer" | "reviewer";
  model: string;
  /** When the dispatch was made. The whole point — a dated fact, not prose. */
  dispatchedAt: string;
  /** Transport status from DispatchResult: success | failure | timeout | cancelled. */
  status: string;
  exitCode: number | null;
  durationMs: number;
  /** Set when status is not success — the runner's own complaint, e.g. a quota refusal. */
  failureCode?: string;
  failureMessage?: string;
}

export interface RunTaskRecord {
  taskId: string;
  outcome: RunTaskOutcome;
  landingCommit: string | null;
  worktree: string | null;
  reason?: string;
  implementerModel?: string;
  reviewerModel?: string;
  continuationPath?: string;
  evidenceQuote?: string;
  verdict?: "accept" | "revise" | "indeterminate";
  /** Appended per dispatch, oldest first. Retained across resume. */
  dispatches?: RunDispatchRecord[];
}

export interface RunsFile {
  version: 1;
  runs: Run[];
}
