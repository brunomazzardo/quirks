// The /v1 HTTP surface — the request and response shapes both sides hold.
//
// This file began (QK-MONO-002) as a mirror of the bun-era service, "never
// leads, until the Effect service takes over". It took over in QK-MONO-003, and
// the request half of this file then sat unimported by anything for the whole of
// QK-MONO/QK-WB while apps/server re-derived every body shape by hand — so the
// "type-only contracts across the boundary" property was real for responses and
// fiction for requests. It leads now: apps/server/src/http/Routes.ts and
// pty/Routes.ts build their bodies AS these types, so a change here that the
// server does not follow is a compile error rather than a runtime surprise.
//
// Type-only, still and always (D3a): no runtime values cross this boundary.
// Paginated JSON on the wire is D6.

import type {
  Goal,
  Run,
  RunMode,
  RunnerKind,
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

/** One pinned source, compared against HEAD at brief-assembly time — the pin
 *  is the baseline that makes "this changed" computable, and the diff reaches
 *  the agent (D17). */
export interface SourceFact {
  path: string;
  pinnedCommit: string | null;
  /** HEAD at assembly time — the other end of the pin comparison. */
  headCommit: string | null;
  /** True when the file's content at pin differs from content at HEAD. */
  changed: boolean;
  /** `git diff pin..HEAD -- path`, empty string when unchanged, null when incomparable. */
  diff: string | null;
  /** ISO author/committer date of the last change to the path at the pin (or null). */
  pinnedLastChanged: string | null;
  headLastChanged: string | null;
}

/** The brief an agent receives: CLI supplies facts, skills supply judgment
 *  (D17). Note S11 reshapes the rendering into a Markdown document; this is
 *  the assembled fact structure underneath. */
export interface TaskBrief {
  task: {
    id: string;
    title: string;
    goal: string | null;
    deliverables: string[];
    acceptanceCriteria: string[];
    verification: string[];
    dependsOn: string[];
    effort?: string;
    risk?: string;
    revision: number;
  };
  goal: {
    id: string;
    title: string;
    why: Goal["why"];
    doneWhen: string[];
  } | null;
  sources: SourceFact[];
  git: {
    baseCommit: string | null;
    candidateCommit: string | null;
    worktree: string | null;
  };
  operatorNotes: string;
  /** sha256:… of the instruction files the agent would hold at this moment. */
  instructionsHash: string;
  /**
   * Present only on a REVIEWER's brief. Without it a reviewer is handed exactly
   * the brief an implementer gets and is never told which role it holds — which
   * is why its "verdict" used to be nothing but an exit code. The lines state
   * the declaration the parent reads back out (runner/Verdict.ts).
   */
  review?: {
    role: "reviewer";
    instructions: string[];
  };
}

export interface RunStartDryResponse {
  dryRun: true;
  plan: RunPlan;
  briefs: TaskBrief[];
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
  /**
   * Which CLI runs the model. Without these the route assumed `claude` for both
   * roles, so a codex or cursor model posted here was dispatched, recorded, and
   * reported under the wrong runner — and `quirks harness` reads those records
   * to answer "did codex ever actually run?".
   *
   * Absent still means `claude`, but as a stated default rather than an
   * inference drawn from a model string nobody parsed.
   */
  implementerRunner?: RunnerKind;
  reviewerRunner?: RunnerKind;
  review?: boolean;
  timeoutMs?: number;
}

// ---- harness ----

// ---- harness: GET /v1/harness?probe=true&timeoutMs=… ----
//
// This was `unknown`, "finalized when the honesty machinery ports
// (QK-MONO-005)" — which landed. The real shapes had meanwhile been declared a
// third time in apps/server/src/cli/Harness.ts, whose own comment says it did so
// only because this type was `unknown` and it would not patch the contract from
// that side. So the wire shape of a served route lived in the CLI's rendering
// layer, invisible to the web. It lives here now.

export interface HarnessRow {
  runner: string;
  executable: string;
  presence: string;
  presenceDetail: string;
  version: string | null;
  versionDetail: string;
  liveness: string;
  livenessDetail: string;
  authorized: string;
  authDetail: string;
  /** Whether tonight's run can lean on this runner (D7). Three answers, because
   *  two would lie: a runner nobody has dispatched is not "yes", nor "no". */
  lean: "yes" | "no" | "unproven";
  leanDetail: string;
  /** May a run be ROUTED here? Presence-based, deliberately ignoring a past
   *  dispatch failure — see `routableFrom` in apps/server/src/ops/Harness.ts. */
  routable: boolean;
}

export interface TierRow {
  tier: string;
  runners: Record<string, { model: string | null; effort: string | null }>;
}

export interface ReviewRow {
  tier: string;
  requiredTier: string;
  selection:
    | {
        kind: "independent";
        reviewer: { runner: string; model: string; tier: string };
        reason: string;
      }
    | { kind: "independence-unavailable"; requiredTier: string; reason: string };
}

export interface HarnessViewResponse {
  generatedAt: string;
  /** True when --probe ran `--version` against each present harness. */
  probed: boolean;
  harnesses: HarnessRow[];
  tiers: TierRow[];
  /** Independent-review availability, assuming a claude implementer. */
  review: ReviewRow[];
  /** Runners a run may lean on right now, best first — the operator's answer. */
  available: RunnerKind[];
  /** Runners a run would actually route to. Presence-based; see `routableFrom`. */
  routable: RunnerKind[];
}

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
