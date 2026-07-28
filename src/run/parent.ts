// Per-task parent loop and run execution (QK-RUN-005).
// One parent per task: claim → implementer → optional reviewer on a DIFFERENT
// model → complete (quote-verified) or apply the failure policy.
// Dispatch is injected so tests do not need real harnesses.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assembleBrief } from "../ops/brief.ts";
import { claimTask, completeTask, blockTask, releaseTask, getTask } from "../ops/tasks.ts";
import { loadRuns, loadTasks, saveRuns, type Store } from "../store/store.ts";
import type { Run, RunMode, RunTaskRecord, Task } from "../store/types.ts";
import { resolveVerdict, type Verdict } from "../runner/quote.ts";
import type { DispatchResult, RunnerKind } from "../runner/types.ts";
import { writeContinuationBrief } from "./continuation.ts";
import { decideFailure } from "./failure-policy.ts";
import { ConflictError, NotFoundError, ValidationError } from "../ops/errors.ts";

export type { RunTaskRecord, RunTaskOutcome } from "../store/types.ts";

/** Extends the persisted run with live per-task records. */
export interface RunExecution extends Run {
  tasks: RunTaskRecord[];
}

export interface ParentDispatchRequest {
  role: "implementer" | "reviewer";
  taskId: string;
  briefPath: string;
  worktree: string;
  artifactDir: string;
  model: string;
  runner: RunnerKind;
}

export interface ParentHooks {
  /** Spawn a runner job; tests inject fakes. */
  dispatch: (req: ParentDispatchRequest) => Promise<DispatchResult & { transcript?: string }>;
  /**
   * After implementer success, return the landing commit SHA if one was
   * verified, else null. The phase boundary keys off this.
   */
  detectLandingCommit: (worktree: string, baseCommit: string | null) => string | null;
  /** Models — reviewer MUST differ from implementer when review runs. */
  implementer: { runner: RunnerKind; model: string };
  reviewer?: { runner: RunnerKind; model: string };
  /** When true (default if reviewer configured), parent dispatches review. */
  review?: boolean;
}

function ensureExecution(run: Run): RunExecution {
  const existing = run as RunExecution;
  if (existing.tasks) return existing;
  return {
    ...run,
    tasks: run.taskIds.map((taskId) => ({
      taskId,
      outcome: "pending" as const,
      landingCommit: null,
      worktree: null,
    })),
  };
}

function saveExecution(store: Store, exec: RunExecution): void {
  const runs = loadRuns(store);
  const idx = runs.findIndex((r) => r.id === exec.id);
  if (idx < 0) throw new NotFoundError(`no run ${exec.id}`);
  runs[idx] = exec;
  saveRuns(store, runs);
}

function dependsOnMap(tasks: Task[]): Map<string, readonly string[]> {
  return new Map(tasks.map((t) => [t.id, t.dependsOn]));
}

/**
 * Reviewer model must differ from the implementer's — the parent never reviews
 * its own task's work (D11).
 */
export function assertDifferentReviewModel(
  implementerModel: string,
  reviewerModel: string | undefined,
): void {
  if (reviewerModel !== undefined && reviewerModel === implementerModel) {
    throw new ValidationError(
      `reviewer model ${JSON.stringify(reviewerModel)} must differ from the implementer — the parent never reviews its own task's work`,
    );
  }
}

export interface ParentResult {
  record: RunTaskRecord;
  /** Ledger side effects already applied (claim/complete/block/release). */
}

/** Drive one task as its parent. */
export async function runParent(
  store: Store,
  run: RunExecution,
  taskId: string,
  hooks: ParentHooks,
): Promise<ParentResult> {
  assertDifferentReviewModel(hooks.implementer.model, hooks.reviewer?.model);

  const task = getTask(store, taskId);
  const worktree = join(store.root, ".worktrees", run.id, taskId);
  mkdirSync(worktree, { recursive: true });
  const artifactDir = join(store.root, ".quirks", "runs", run.id, taskId);
  mkdirSync(artifactDir, { recursive: true });

  const record: RunTaskRecord = {
    taskId,
    outcome: "running",
    landingCommit: null,
    worktree,
    implementerModel: hooks.implementer.model,
    ...(hooks.reviewer ? { reviewerModel: hooks.reviewer.model } : {}),
  };

  // Claim — ownership for the duration.
  claimTask(store, taskId, { by: `run:${run.id}` });

  const brief = assembleBrief(store, task, { worktree });
  const briefPath = join(artifactDir, "brief.json");
  writeFileSync(briefPath, JSON.stringify(brief, null, 2));

  const impl = await hooks.dispatch({
    role: "implementer",
    taskId,
    briefPath,
    worktree,
    artifactDir,
    model: hooks.implementer.model,
    runner: hooks.implementer.runner,
  });

  if (impl.status !== "success") {
    return finishFailure(store, run, record, impl.failure?.message ?? impl.status);
  }

  const landing = hooks.detectLandingCommit(worktree, brief.git.baseCommit);
  record.landingCommit = landing;

  const wantsReview = hooks.review !== false && hooks.reviewer !== undefined;
  if (wantsReview) {
    const rev = await hooks.dispatch({
      role: "reviewer",
      taskId,
      briefPath,
      worktree,
      artifactDir,
      model: hooks.reviewer!.model,
      runner: hooks.reviewer!.runner,
    });
    const transcript = rev.transcript ?? "";
    const claimed: Verdict =
      rev.status === "success" ? "accept" : rev.status === "failure" ? "revise" : "indeterminate";
    // Prefer an explicit quote from the result notes if present; else absence.
    const quote = rev.notes?.find((n) => n.startsWith("quote:"))?.slice("quote:".length) ?? "";
    const verdict = resolveVerdict({ claimed, quote, transcript });
    record.verdict = verdict;
    record.evidenceQuote = quote;

    if (verdict !== "accept") {
      // Honest partial: landing exists but review did not accept.
      if (landing && verdict === "indeterminate") {
        const path = writeContinuationBrief({
          taskId,
          worktree,
          whatExists: [`landing commit ${landing}`],
          remaining: ["resolve review indeterminate — re-read the transcript"],
        });
        record.continuationPath = path;
        record.outcome = "partial";
        // Partial with landing under park-on-issue → hold; autonomous continues.
        return finishFailure(store, run, record, `review verdict ${verdict}`, landing);
      }
      return finishFailure(store, run, record, `review verdict ${verdict}`, landing);
    }
  }

  // Accepted path — complete with evidence.
  const evidence = record.evidenceQuote
    ? `verdict accept; quote-verified: ${record.evidenceQuote.slice(0, 200)}`
    : `implementer ${impl.jobId} succeeded` + (landing ? `; landed ${landing}` : "");
  completeTask(store, taskId, { evidence });
  record.outcome = "accepted";
  return { record };
}

function finishFailure(
  store: Store,
  run: RunExecution,
  record: RunTaskRecord,
  detail: string,
  landingCommit: string | null = record.landingCommit,
): ParentResult {
  const tasks = loadTasks(store);
  const decision = decideFailure({
    mode: run.mode,
    failedId: record.taskId,
    landingCommit,
    taskIds: run.taskIds,
    dependsOn: dependsOnMap(tasks),
    detail,
  });
  record.landingCommit = landingCommit;
  record.reason = decision.reason;

  if (decision.action === "release") {
    try {
      releaseTask(store, record.taskId);
    } catch {
      /* already open */
    }
    record.outcome = record.outcome === "partial" ? "partial" : "released";
  } else if (decision.action === "hold") {
    blockTask(store, record.taskId, { reason: decision.reason });
    record.outcome = "held";
  } else {
    // autonomous continue — block so it does not look open for another claim.
    blockTask(store, record.taskId, { reason: decision.reason });
    if (record.outcome !== "partial") record.outcome = "failed";
  }

  record.reason = `${decision.reason} [block: ${decision.blockDependents.join(",") || "none"}]`;
  return { record };
}

export interface ExecuteResult {
  run: RunExecution;
}

/** Walk an approved/running run in dependency order; failures block dependents only. */
export async function executeRun(
  store: Store,
  idOrSlug: string,
  hooks: ParentHooks,
): Promise<ExecuteResult> {
  const loaded = loadRuns(store).find((r) => r.id === idOrSlug || r.slug === idOrSlug);
  if (!loaded) throw new NotFoundError(`no run ${idOrSlug}`);
  if (loaded.status !== "approved" && loaded.status !== "running") {
    throw new ConflictError(`run ${loaded.id} is ${loaded.status} — only approved/running runs execute`);
  }

  let exec = ensureExecution(loaded);
  const now = new Date().toISOString();
  exec.status = "running";
  exec.startedAt = exec.startedAt ?? now;
  exec.updatedAt = now;
  saveExecution(store, exec);

  const failedIds = new Set<string>();

  for (const taskId of exec.taskIds) {
    const rec = exec.tasks.find((t) => t.taskId === taskId)!;
    if (rec.outcome === "blocked" || rec.outcome === "accepted") continue;

    // If any dependency in this run failed/held/released/blocked, skip.
    const task = getTask(store, taskId);
    const unmet = task.dependsOn.filter(
      (d) =>
        exec.taskIds.includes(d) &&
        failedIds.has(d),
    );
    if (unmet.length > 0) {
      rec.outcome = "blocked";
      rec.reason = `blocked by failed dependency: ${unmet.join(", ")}`;
      try {
        blockTask(store, taskId, { reason: rec.reason });
      } catch {
        /* may already be blocked */
      }
      failedIds.add(taskId);
      exec.updatedAt = new Date().toISOString();
      saveExecution(store, exec);
      continue;
    }

    const { record } = await runParent(store, exec, taskId, hooks);
    Object.assign(rec, record);
    if (record.outcome !== "accepted") {
      failedIds.add(taskId);
      // Apply dependent blocking now so later iterations see it.
      const decision = decideFailure({
        mode: exec.mode as RunMode,
        failedId: taskId,
        landingCommit: record.landingCommit,
        taskIds: exec.taskIds,
        dependsOn: dependsOnMap(loadTasks(store)),
      });
      for (const dep of decision.blockDependents) {
        failedIds.add(dep);
        const depRec = exec.tasks.find((t) => t.taskId === dep);
        if (depRec && depRec.outcome === "pending") {
          depRec.outcome = "blocked";
          depRec.reason = `blocked by ${taskId}`;
          try {
            blockTask(store, dep, { reason: depRec.reason });
          } catch {
            /* ok */
          }
        }
      }
    }
    exec.updatedAt = new Date().toISOString();
    saveExecution(store, exec);
  }

  exec.status = "completed";
  exec.completedAt = new Date().toISOString();
  exec.updatedAt = exec.completedAt;
  saveExecution(store, exec);
  return { run: exec };
}
