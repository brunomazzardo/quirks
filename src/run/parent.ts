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

/** Outcomes that mean "already settled — do not re-dispatch on resume". */
const SETTLED_SKIP = new Set(["accepted", "blocked", "held", "failed"]);

/** Outcomes that resume will attempt again. */
export function shouldAttemptOnResume(outcome: RunTaskRecord["outcome"]): boolean {
  return !SETTLED_SKIP.has(outcome);
}

/**
 * QK-CTL-012 class: a run reported completed must have actually transitioned
 * its tasks in the ledger. Returns human-readable mismatches; empty = durable.
 */
export function durableCompletionErrors(store: Store, exec: RunExecution): string[] {
  const errors: string[] = [];
  for (const rec of exec.tasks) {
    let task;
    try {
      task = getTask(store, rec.taskId);
    } catch {
      errors.push(`${rec.taskId}: run record cites a task that is not in the ledger`);
      continue;
    }
    switch (rec.outcome) {
      case "accepted":
        if (task.status !== "completed") {
          errors.push(`${rec.taskId}: run says accepted but ledger is ${task.status}`);
        }
        break;
      case "held":
      case "blocked":
      case "failed":
        if (task.status !== "blocked") {
          errors.push(`${rec.taskId}: run says ${rec.outcome} but ledger is ${task.status}`);
        }
        break;
      case "released":
        if (task.status !== "open") {
          errors.push(`${rec.taskId}: run says released but ledger is ${task.status}`);
        }
        break;
      case "pending":
      case "running":
        errors.push(`${rec.taskId}: still ${rec.outcome} — run is not finished`);
        break;
      case "partial":
        // Partial under autonomous keeps outcome "partial" while ledger is blocked.
        if (task.status !== "blocked" && task.status !== "open" && task.status !== "claimed") {
          errors.push(`${rec.taskId}: run says partial but ledger is ${task.status}`);
        }
        break;
    }
  }
  return errors;
}

/**
 * Mark completed only when every task is settled AND the ledger matches.
 * Otherwise leave status as running and refuse the lie (QK-CTL-012).
 */
export function finalizeRun(store: Store, exec: RunExecution): RunExecution {
  const errors = durableCompletionErrors(store, exec);
  if (errors.length > 0) {
    exec.status = "running";
    exec.updatedAt = new Date().toISOString();
    // Do not set completedAt — it never finished durably.
    delete exec.completedAt;
    saveExecution(store, exec);
    throw new ConflictError(
      `refusing to report run ${exec.id} completed — durable completion failed:\n  - ${errors.join("\n  - ")}`,
    );
  }
  exec.status = "completed";
  exec.completedAt = new Date().toISOString();
  exec.updatedAt = exec.completedAt;
  saveExecution(store, exec);
  return exec;
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

/** Walk an approved/running run in dependency order; failures block dependents only.
 *  Resume-safe: settled outcomes are skipped; pending/released/partial/running retry. */
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
  // A previous incomplete finalize may have left a completedAt — clear it.
  delete exec.completedAt;
  saveExecution(store, exec);

  const failedIds = new Set<string>(
    exec.tasks.filter((t) => ["failed", "blocked", "held", "released"].includes(t.outcome)).map((t) => t.taskId),
  );

  for (const taskId of exec.taskIds) {
    const rec = exec.tasks.find((t) => t.taskId === taskId)!;
    if (!shouldAttemptOnResume(rec.outcome)) continue;

    // If any dependency in this run failed/held/released/blocked, skip.
    const task = getTask(store, taskId);
    const unmet = task.dependsOn.filter((d) => exec.taskIds.includes(d) && failedIds.has(d));
    if (unmet.length > 0) {
      rec.outcome = "blocked";
      rec.reason = `blocked by failed dependency: ${unmet.join(", ")}`;
      try {
        if (task.status === "open" || task.status === "claimed") {
          blockTask(store, taskId, { reason: rec.reason });
        }
      } catch {
        /* may already be blocked */
      }
      failedIds.add(taskId);
      exec.updatedAt = new Date().toISOString();
      saveExecution(store, exec);
      continue;
    }

    // Released tasks are open again; partial/running may still be claimed — release first if needed.
    if (task.status === "claimed" && (rec.outcome === "partial" || rec.outcome === "running")) {
      try {
        releaseTask(store, taskId);
      } catch {
        /* ok */
      }
    }

    const { record } = await runParent(store, exec, taskId, hooks);
    Object.assign(rec, record);
    if (record.outcome !== "accepted") {
      failedIds.add(taskId);
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
        if (depRec && shouldAttemptOnResume(depRec.outcome)) {
          depRec.outcome = "blocked";
          depRec.reason = `blocked by ${taskId}`;
          try {
            const depTask = getTask(store, dep);
            if (depTask.status === "open" || depTask.status === "claimed") {
              blockTask(store, dep, { reason: depRec.reason });
            }
          } catch {
            /* ok */
          }
        }
      }
    }
    exec.updatedAt = new Date().toISOString();
    saveExecution(store, exec);
  }

  // Durable completion — never report completed on a lie (QK-CTL-012).
  finalizeRun(store, exec);
  return { run: exec };
}

/** `quirks run --resume <name|id>` — same execute path, picks up where it stopped. */
export async function resumeRun(
  store: Store,
  idOrSlug: string,
  hooks: ParentHooks,
): Promise<ExecuteResult> {
  const loaded = loadRuns(store).find((r) => r.id === idOrSlug || r.slug === idOrSlug);
  if (!loaded) throw new NotFoundError(`no run ${idOrSlug} — quirks run list shows what exists`);
  if (loaded.status === "completed") {
    throw new ConflictError(`run ${loaded.id} is already completed — nothing to resume`);
  }
  if (loaded.status === "abandoned") {
    throw new ConflictError(`run ${loaded.id} is abandoned — nothing to resume`);
  }
  if (loaded.status === "planned") {
    throw new ConflictError(`run ${loaded.id} is only planned — approve it with quirks run --yes first`);
  }
  // approved or running — executeRun handles both.
  return executeRun(store, loaded.id, hooks);
}
