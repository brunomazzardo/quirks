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
