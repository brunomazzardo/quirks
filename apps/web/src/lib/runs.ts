// The run views' model (QK-WB-007), carried forward from the abandoned native
// workbench's QK-NAT-004. Everything here is pure so it can be tested without a
// DOM; the components in ../components/run-*.tsx only render what these return.
//
// The rules are not this file's inventions — they are D14 ("what needs you,
// first") and the run record the honesty machinery actually writes
// (apps/server/src/run/Parent.ts), transcribed:
//
//   - Sections are NEEDS YOU → PARTIAL → ACCEPTED, never chronological, and an
//     empty section is omitted.
//   - `indeterminate` is its own outcome and prints under NEEDS YOU. Absence
//     fails closed everywhere in this product; a report that quietly dropped an
//     unreadable verdict would be the one place it did not.
//   - A rejected task keeps its exit code and its own words. Nothing here
//     softens, summarises, or paraphrases a runner — see `evidenceQuote` and
//     `RunDispatchRecord.failureMessage`, both rendered verbatim.
//
// One join, one truth: `runEntries` is the only place records, plan rows and
// task ids meet, so the progress counts on a list row and the sections in the
// report can never disagree about the same run.

import type {
  Run,
  RunDispatchRecord,
  RunPlanEntry,
  RunStatus,
  RunTaskOutcome,
  RunTaskRecord,
} from "@quirks/contracts";

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

/** Nothing more will happen to this run — the live view becomes the report. */
export function runIsTerminal(status: RunStatus): boolean {
  return status === "completed" || status === "abandoned";
}

/**
 * Is this run worth watching?
 *
 * `running` is executing. `approved` is durable-and-not-yet-executing: the CLI
 * approves and executes in one breath (`quirks run --yes`), so an approved run
 * is one HTTP call away from moving and is watched too. `planned` is a dry-run
 * artefact — it has no execution ahead of it, so it is read once and left.
 */
export function runIsLive(status: RunStatus): boolean {
  return status === "running" || status === "approved";
}

// ---------------------------------------------------------------------------
// what needs you
// ---------------------------------------------------------------------------

/**
 * D14's NEEDS YOU spelled in the record vocabulary Parent.ts writes.
 *
 *   rejected       `failed` (autonomous) or `released` (park-on-issue with no
 *                  landing commit — the same rejection, differing only in what
 *                  happened to the assignment)
 *   held           held after a verified landing; never unassigned (D13)
 *   indeterminate  the verdict could not be read from the transcript
 *   blocked        collateral: a dependency in this run failed. Not one of
 *                  D14's three names, but the operator has to act on it, and
 *                  QK-WB-007 asks for it here explicitly.
 *
 * Outcome is checked before verdict on purpose: a rejected task that also
 * carries an unreadable verdict is *rejected*, which is the stronger fact.
 */
export type NeedsYouKind = "rejected" | "held" | "indeterminate" | "blocked";

export function needsYouKind(record: RunTaskRecord): NeedsYouKind | null {
  if (record.outcome === "failed" || record.outcome === "released") return "rejected";
  if (record.outcome === "held") return "held";
  if (record.outcome === "blocked") return "blocked";
  if (record.verdict === "indeterminate") return "indeterminate";
  return null;
}

/** Within NEEDS YOU, D14's own listing order: ✗ rejected, then ⚠ held, then the
 *  unreadable, then what someone else's failure took down with it. */
const NEEDS_YOU_RANK: Record<NeedsYouKind, number> = {
  rejected: 0,
  held: 1,
  indeterminate: 2,
  blocked: 3,
};

// ---------------------------------------------------------------------------
// the join
// ---------------------------------------------------------------------------

export interface RunEntry {
  readonly taskId: string;
  readonly record: RunTaskRecord;
  /** The approved plan row, when this task was in the plan. */
  readonly plan: RunPlanEntry | null;
  readonly title: string;
  /** Plan order; unplanned rows sort after every planned one. */
  readonly order: number;
  readonly needs: NeedsYouKind | null;
  readonly dispatches: readonly RunDispatchRecord[];
  /** True when no record existed and this row was synthesised as pending. */
  readonly unrecorded: boolean;
}

/** Larger than any plan we will ever print, and stable. */
const UNPLANNED_ORDER = Number.MAX_SAFE_INTEGER;

/**
 * Every task the run was approved to do, joined to whatever the runner recorded
 * about it.
 *
 * A task id with no record is NOT dropped — it becomes a synthetic `pending`
 * row. During a run that is the queue; after one it is the honest statement
 * that an approved task was never touched, which is exactly the thing a
 * summary built only from `tasks[]` would silently lose.
 */
export function runEntries(run: Run): readonly RunEntry[] {
  const planById = new Map(run.plan.map((entry) => [entry.id, entry]));
  const records = run.tasks ?? [];
  const recordById = new Map(records.map((record) => [record.taskId, record]));

  // The run's own order first (taskIds is dependency order), then any record
  // for a task the plan never listed — it happened, so it is shown.
  const ids = [...run.taskIds];
  for (const record of records) if (!ids.includes(record.taskId)) ids.push(record.taskId);

  return ids.map((taskId) => {
    const plan = planById.get(taskId) ?? null;
    const record: RunTaskRecord = recordById.get(taskId) ?? {
      taskId,
      outcome: "pending",
      landingCommit: null,
      worktree: null,
    };
    return {
      taskId,
      record,
      plan,
      title: plan?.title ?? taskId,
      order: plan?.order ?? UNPLANNED_ORDER,
      needs: needsYouKind(record),
      dispatches: record.dispatches ?? [],
      unrecorded: !recordById.has(taskId),
    };
  });
}

// ---------------------------------------------------------------------------
// progress
// ---------------------------------------------------------------------------

export interface RunProgress {
  readonly total: number;
  readonly accepted: number;
  readonly partial: number;
  readonly rejected: number;
  readonly held: number;
  readonly blocked: number;
  readonly indeterminate: number;
  readonly running: number;
  readonly pending: number;
  /** The one number the list row leads with. */
  readonly needsYou: number;
}

export function runProgress(run: Run): RunProgress {
  const entries = runEntries(run);
  let accepted = 0;
  let partial = 0;
  let rejected = 0;
  let held = 0;
  let blocked = 0;
  let indeterminate = 0;
  let running = 0;
  let pending = 0;

  for (const entry of entries) {
    switch (entry.needs) {
      case "rejected":
        rejected += 1;
        continue;
      case "held":
        held += 1;
        continue;
      case "blocked":
        blocked += 1;
        continue;
      case "indeterminate":
        indeterminate += 1;
        continue;
      default:
        break;
    }
    if (entry.record.outcome === "accepted") accepted += 1;
    else if (entry.record.outcome === "partial") partial += 1;
    else if (entry.record.outcome === "running") running += 1;
    else pending += 1;
  }

  return {
    total: entries.length,
    accepted,
    partial,
    rejected,
    held,
    blocked,
    indeterminate,
    running,
    pending,
    needsYou: rejected + held + blocked + indeterminate,
  };
}

/**
 * The colour a run is allowed to wear (QK-WB-006's palette: moss passes, ember
 * fails, everything else stays muted).
 *
 * Failure outranks liveness deliberately — a running run that has already lost
 * a task is an ember row, because the report leads with failures and so does
 * the list that points at it. The moss *pulse* is separate (`runIsLive`), so a
 * run that is both moving and damaged still says both.
 */
export type RunTone = "attention" | "live" | "clean" | "quiet";

export function runTone(run: Run): RunTone {
  if (runProgress(run).needsYou > 0) return "attention";
  if (run.status === "running") return "live";
  if (run.status === "completed") return "clean";
  return "quiet";
}

// ---------------------------------------------------------------------------
// the list
// ---------------------------------------------------------------------------

export interface RunRow {
  readonly run: Run;
  readonly progress: RunProgress;
  readonly tone: RunTone;
  readonly live: boolean;
}

/**
 * Newest first.
 *
 * `listRuns` (apps/server/src/ops/Runs.ts) already sorts by `createdAt`
 * descending; sorting again costs nothing and means the view states its own
 * order rather than inheriting one it cannot see. Ties break on id descending,
 * the same rule the ledger rail uses.
 */
export function buildRunRows(runs: readonly Run[]): readonly RunRow[] {
  return [...runs]
    .sort((a, b) => compareDesc(a.createdAt, b.createdAt) || compareDesc(a.id, b.id))
    .map((run) => ({
      run,
      progress: runProgress(run),
      tone: runTone(run),
      live: runIsLive(run.status),
    }));
}

function compareDesc(a: string, b: string): number {
  if (a < b) return 1;
  if (a > b) return -1;
  return 0;
}

// ---------------------------------------------------------------------------
// the report — D14 order, never chronological
// ---------------------------------------------------------------------------

export type ReportSectionId = "needs-you" | "partial" | "accepted" | "in-flight";

export interface ReportSection {
  readonly id: ReportSectionId;
  readonly label: string;
  readonly entries: readonly RunEntry[];
}

/** IN FLIGHT is not D14's — D14 describes a finished night. A live run needs
 *  somewhere honest to put what is still queued or mid-dispatch, and it goes
 *  last because it is the one thing nobody has to act on yet. */
const SECTION_LABELS: Record<ReportSectionId, string> = {
  "needs-you": "NEEDS YOU",
  partial: "PARTIAL",
  accepted: "ACCEPTED",
  "in-flight": "IN FLIGHT",
};

function sectionOf(entry: RunEntry): ReportSectionId {
  if (entry.needs !== null) return "needs-you";
  if (entry.record.outcome === "partial") return "partial";
  if (entry.record.outcome === "accepted") return "accepted";
  return "in-flight";
}

/**
 * One run as the morning report: what needs you, then what half-landed, then
 * what worked, then what is still moving. Empty sections are omitted (D14).
 *
 * Ordering inside a section is deterministic and NOT time-based — severity
 * rank, then the approved plan order, then the task id. A live run that
 * re-polls every two seconds must not reshuffle under the reader's eyes.
 */
export function buildRunReport(run: Run): readonly ReportSection[] {
  const buckets = new Map<ReportSectionId, RunEntry[]>();
  for (const entry of runEntries(run)) {
    const id = sectionOf(entry);
    const bucket = buckets.get(id);
    if (bucket === undefined) buckets.set(id, [entry]);
    else bucket.push(entry);
  }

  const order: readonly ReportSectionId[] = ["needs-you", "partial", "accepted", "in-flight"];
  const sections: ReportSection[] = [];
  for (const id of order) {
    const entries = buckets.get(id);
    if (entries === undefined || entries.length === 0) continue;
    sections.push({
      id,
      label: SECTION_LABELS[id],
      entries: entries.sort(
        (a, b) =>
          rankOf(a) - rankOf(b) ||
          a.order - b.order ||
          (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0),
      ),
    });
  }
  return sections;
}

function rankOf(entry: RunEntry): number {
  return entry.needs === null ? 0 : NEEDS_YOU_RANK[entry.needs];
}

// ---------------------------------------------------------------------------
// dispatches — what was asked of whom, and what they said back
// ---------------------------------------------------------------------------

/** Transport success, not a judgment of the work: that is `verdict`. */
export function dispatchSucceeded(dispatch: RunDispatchRecord): boolean {
  return dispatch.status === "success";
}

/** The attempt that produced the outcome — dispatches are appended oldest
 *  first and retained across resume, so "what ran" is the last one. */
export function lastDispatch(
  dispatches: readonly RunDispatchRecord[],
  role?: RunDispatchRecord["role"],
): RunDispatchRecord | null {
  for (let index = dispatches.length - 1; index >= 0; index -= 1) {
    const dispatch = dispatches[index];
    if (dispatch === undefined) continue;
    if (role === undefined || dispatch.role === role) return dispatch;
  }
  return null;
}

// ---------------------------------------------------------------------------
// the plan, against what actually ran
// ---------------------------------------------------------------------------

export interface PlanComparisonRow {
  readonly entry: RunPlanEntry;
  readonly outcome: RunTaskOutcome | null;
  /** From the implementer dispatch that produced the outcome. */
  readonly actualRunner: string | null;
  readonly actualModel: string | null;
  readonly attempts: number;
  /** Only ever true when BOTH sides are known — an undispatched row is not a
   *  divergence, it is a row nothing happened to yet. */
  readonly diverged: boolean;
}

export function planComparison(run: Run): readonly PlanComparisonRow[] {
  const byId = new Map(runEntries(run).map((entry) => [entry.taskId, entry]));
  return [...run.plan]
    .sort((a, b) => a.order - b.order)
    .map((entry) => {
      const joined = byId.get(entry.id);
      const dispatches = joined?.dispatches ?? [];
      const implementer = lastDispatch(dispatches, "implementer");
      const actualRunner = implementer?.runner ?? null;
      const actualModel = joined?.record.implementerModel ?? implementer?.model ?? null;
      return {
        entry,
        outcome: joined?.record.outcome ?? null,
        actualRunner,
        actualModel,
        attempts: dispatches.filter((dispatch) => dispatch.role === "implementer").length,
        diverged:
          (actualRunner !== null && actualRunner !== entry.harness) ||
          (actualModel !== null && actualModel !== entry.model),
      };
    });
}

// ---------------------------------------------------------------------------
// polling — live = GET /v1/runs/:id on a timer, because runs have no SSE
// ---------------------------------------------------------------------------

/** Fast enough that a landing record feels immediate, slow enough that a
 *  loopback JSON read is free. */
export const POLL_VISIBLE_MS = 2_000;

/** A hidden tab is nobody watching. Back off hard rather than stop: coming
 *  back to a stale view is worse than one extra request a quarter minute. */
export const POLL_HIDDEN_MS = 15_000;

/** No backoff climbs past this — a daemon that comes back should be noticed
 *  within half a minute. */
export const POLL_CEILING_MS = 30_000;

export interface PollInput {
  readonly status: RunStatus;
  /** `document.hidden` at the moment the next poll is scheduled. */
  readonly hidden: boolean;
  /** Reads that failed back-to-back; reset by the first success. */
  readonly consecutiveFailures: number;
}

/**
 * How long until the next `GET /v1/runs/:id`, or `null` to stop for good.
 *
 * Stopping is the important half: a terminal run cannot change, so a view that
 * kept polling one would be asking a question it already has the final answer
 * to. That is also what makes "the live view becomes the retrospective" true
 * rather than decorative — same component, same data, one fewer timer.
 */
export function nextPollDelay(input: PollInput): number | null {
  if (!runIsLive(input.status)) return null;
  const base = input.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
  const failures = Math.min(Math.max(input.consecutiveFailures, 0), 16);
  return Math.min(base * 2 ** failures, POLL_CEILING_MS);
}

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

/** Dispatch durations, in the units a person reads them in. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Wall-clock span of a run: started → finished, or → now while it is moving.
 *  Null when the run never started — never a zero standing in for unknown. */
export function runElapsedMs(run: Run, now: number = Date.now()): number | null {
  if (run.startedAt === undefined) return null;
  const started = Date.parse(run.startedAt);
  if (Number.isNaN(started)) return null;
  const end = run.completedAt === undefined ? now : Date.parse(run.completedAt);
  if (Number.isNaN(end)) return null;
  return Math.max(0, end - started);
}

/** An ISO stamp as a local time, or "—". A dated fact is the whole point of a
 *  dispatch record, so an unparseable one says so instead of showing "now". */
export function formatStamp(iso: string | undefined | null): string {
  if (iso === undefined || iso === null || iso.trim().length === 0) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatClock(iso: string | undefined | null): string {
  if (iso === undefined || iso === null || iso.trim().length === 0) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
