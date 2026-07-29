// Per-task parent loop and run execution (QK-RUN-005).
// One parent per task: claim → implementer → optional reviewer on a DIFFERENT
// model → complete (quote-verified) or apply the failure policy.
// Dispatch is injected so tests do not need real harnesses.
// Ported from the bun-era src/run/parent.ts (QK-MONO-005).
//
// `ParentHooks.dispatch` returns an `Effect<DispatchOutcome>` with no error and
// no requirements. That is the injection point: the real hooks close over the
// spawner's context (see run/Hooks.ts), a test hands back a value. Neither the
// parent loop nor `executeRun` can reach a process, which is what makes "tests
// must never spawn a real runner" a property of the types.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import type { Run, RunDispatchRecord, RunTaskRecord, Task } from "@quirks/contracts";
import { assembleBrief, reviewerBriefSection } from "../ops/Brief.ts";
import { conflict, missing, invalid, type OpError } from "../ops/Errors.ts";
import { blockTask, claimTask, completeTask, getTask, releaseTask } from "../ops/Tasks.ts";
import { runArtifactDir } from "../store/LedgerPaths.ts";
import { Ledger, Store } from "../store/Store.ts";
import type { StoreError } from "../store/JsonFile.ts";
import type { TransitionError } from "../store/Transitions.ts";
import { resolveVerdict } from "../runner/Quote.ts";
import { reviewClaim } from "../runner/Verdict.ts";
import type { DispatchOutcome, RunnerKind } from "../runner/Types.ts";
import { writeContinuationBrief } from "./Continuation.ts";
import { decideFailure, type FailureDecision } from "./FailurePolicy.ts";

export type { RunTaskRecord, RunTaskOutcome } from "@quirks/contracts";

/** Everything the parent loop can fail with. */
export type RunError = StoreError | OpError | TransitionError;

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
export const durableCompletionErrors = (
  exec: RunExecution,
): Effect.Effect<string[], StoreError, Ledger> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const tasks = yield* ledger.loadTasks;
    const errors: string[] = [];
    for (const rec of exec.tasks) {
      const task = tasks.find((t) => t.id === rec.taskId);
      if (!task) {
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
  });

const saveExecution = (exec: RunExecution): Effect.Effect<void, StoreError | OpError, Ledger> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const runs = yield* ledger.loadRuns;
    const idx = runs.findIndex((r) => r.id === exec.id);
    if (idx < 0) return yield* missing(`no run ${exec.id}`);
    runs[idx] = exec;
    yield* ledger.saveRuns(runs);
  });

/**
 * Mark completed only when every task is settled AND the ledger matches.
 * Otherwise leave status as running and refuse the lie (QK-CTL-012).
 */
export const finalizeRun = (
  exec: RunExecution,
): Effect.Effect<RunExecution, StoreError | OpError, Ledger> =>
  Effect.gen(function* () {
    const errors = yield* durableCompletionErrors(exec);
    if (errors.length > 0) {
      exec.status = "running";
      exec.updatedAt = new Date().toISOString();
      // Do not set completedAt — it never finished durably.
      delete exec.completedAt;
      yield* saveExecution(exec);
      return yield* conflict(
        `refusing to report run ${exec.id} completed — durable completion failed:\n  - ${errors.join("\n  - ")}`,
      );
    }
    exec.status = "completed";
    exec.completedAt = new Date().toISOString();
    exec.updatedAt = exec.completedAt;
    yield* saveExecution(exec);
    return exec;
  });

export interface ParentDispatchRequest {
  readonly role: "implementer" | "reviewer";
  readonly taskId: string;
  readonly briefPath: string;
  readonly worktree: string;
  readonly artifactDir: string;
  readonly model: string;
  readonly runner: RunnerKind;
}

export interface ParentHooks {
  /** Spawn a runner job; tests inject fakes. */
  readonly dispatch: (req: ParentDispatchRequest) => Effect.Effect<DispatchOutcome>;
  /**
   * After implementer success, return the landing commit SHA if one was
   * verified, else null. The phase boundary keys off this.
   */
  readonly detectLandingCommit: (worktree: string, baseCommit: string | null) => string | null;
  /** Models — reviewer MUST differ from implementer when review runs. */
  readonly implementer: { readonly runner: RunnerKind; readonly model: string };
  readonly reviewer?: { readonly runner: RunnerKind; readonly model: string } | undefined;
  /** When true (default if reviewer configured), parent dispatches review. */
  readonly review?: boolean | undefined;
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

function dependsOnMap(tasks: readonly Task[]): Map<string, readonly string[]> {
  return new Map(tasks.map((t) => [t.id, t.dependsOn]));
}

/**
 * Reviewer model must differ from the implementer's — the parent never reviews
 * its own task's work (D11).
 */
export const assertDifferentReviewModel = (
  implementerModel: string,
  reviewerModel: string | undefined,
): Effect.Effect<void, OpError> =>
  reviewerModel !== undefined && reviewerModel === implementerModel
    ? invalid(
        `reviewer model ${JSON.stringify(reviewerModel)} must differ from the implementer — the parent never reviews its own task's work`,
      )
    : Effect.void;

export interface ParentResult {
  readonly record: RunTaskRecord;
  /** Ledger side effects already applied (claim/complete/block/release). */

  /**
   * The failure policy's answer, present only when the task failed.
   *
   * It is CARRIED rather than recomputed. `decideFailure` used to run twice per
   * failure — once here and once in `executeRun` — against two different ledger
   * snapshots that could disagree, with the first answer surviving only as prose
   * serialized into `record.reason` and never read. One failure, one decision.
   */
  readonly decision?: FailureDecision;
}

/**
 * Record one dispatch as it happened, so `quirks harness` can answer "did codex
 * answer tonight" and `quirks report` can tell the per-task story — neither has
 * to re-derive it or read a doc. A failure keeps the runner's own words: that is
 * where a quota refusal lives, with a real date attached.
 */
function recordDispatch(
  record: RunTaskRecord,
  req: ParentDispatchRequest,
  dispatchedAt: string,
  result: DispatchOutcome,
): void {
  const entry: RunDispatchRecord = {
    runner: req.runner,
    role: req.role,
    model: req.model,
    dispatchedAt,
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    ...(result.failure
      ? { failureCode: result.failure.code, failureMessage: result.failure.message }
      : {}),
  };
  record.dispatches = [...(record.dispatches ?? []), entry];
}

const finishFailure = (
  run: RunExecution,
  record: RunTaskRecord,
  detail: string,
  landingCommit: string | null = record.landingCommit,
): Effect.Effect<ParentResult, RunError, Ledger> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const tasks = yield* ledger.loadTasks;
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
      yield* releaseTask(record.taskId).pipe(Effect.ignore);
      record.outcome = record.outcome === "partial" ? "partial" : "released";
    } else if (decision.action === "hold") {
      yield* blockTask(record.taskId, { reason: decision.reason });
      record.outcome = "held";
    } else {
      // autonomous continue — block so it does not look open for another claim.
      yield* blockTask(record.taskId, { reason: decision.reason });
      if (record.outcome !== "partial") record.outcome = "failed";
    }

    return { record, decision };
  });

/** Drive one task as its parent. */
export const runParent = (
  run: RunExecution,
  taskId: string,
  hooks: ParentHooks,
): Effect.Effect<ParentResult, RunError, Ledger | Store> =>
  Effect.gen(function* () {
    yield* assertDifferentReviewModel(hooks.implementer.model, hooks.reviewer?.model);

    const store = yield* Store;
    const task = yield* getTask(taskId);
    const worktree = join(store.root, ".worktrees", run.id, taskId);
    const artifactDir = runArtifactDir(store.root, run.id, taskId);
    yield* Effect.sync(() => {
      mkdirSync(worktree, { recursive: true });
      mkdirSync(artifactDir, { recursive: true });
    });

    const record: RunTaskRecord = {
      taskId,
      outcome: "running",
      landingCommit: null,
      worktree,
      implementerModel: hooks.implementer.model,
      ...(hooks.reviewer ? { reviewerModel: hooks.reviewer.model } : {}),
    };

    // Claim — ownership for the duration.
    yield* claimTask(taskId, { by: `run:${run.id}` });

    const brief = yield* assembleBrief(task, { worktree });
    const briefPath = join(artifactDir, "brief.json");
    yield* Effect.sync(() => writeFileSync(briefPath, JSON.stringify(brief, null, 2)));

    const implReq: ParentDispatchRequest = {
      role: "implementer",
      taskId,
      briefPath,
      worktree,
      artifactDir,
      model: hooks.implementer.model,
      runner: hooks.implementer.runner,
    };
    const implAt = new Date().toISOString();
    const impl = yield* hooks.dispatch(implReq);
    recordDispatch(record, implReq, implAt, impl);

    if (impl.status !== "success") {
      return yield* finishFailure(run, record, impl.failure?.message ?? impl.status);
    }

    const landing = hooks.detectLandingCommit(worktree, brief.git.baseCommit);
    record.landingCommit = landing;

    const reviewer = hooks.reviewer;
    const wantsReview = hooks.review !== false && reviewer !== undefined;
    if (wantsReview) {
      // A reviewer gets its OWN brief. Handing it the implementer's meant it was
      // never told which role it held, so the only thing it could express was an
      // exit code — and an exit code is not a judgment about work.
      //
      // Derived from the brief already assembled, not assembled again: the two
      // differ by one key, and `assembleBrief` shells out to git up to three
      // times per sourceRef plus a HEAD read and an instructions hash — all
      // synchronous, so a second pass blocks the daemon for as long as it runs.
      // It would also let the two briefs snapshot different HEADs.
      const reviewBrief = { ...brief, review: reviewerBriefSection() };
      const reviewBriefPath = join(artifactDir, "review-brief.json");
      yield* Effect.sync(() =>
        writeFileSync(reviewBriefPath, JSON.stringify(reviewBrief, null, 2)),
      );
      const revReq: ParentDispatchRequest = {
        role: "reviewer",
        taskId,
        briefPath: reviewBriefPath,
        worktree,
        artifactDir,
        model: reviewer.model,
        runner: reviewer.runner,
      };
      const revAt = new Date().toISOString();
      const rev = yield* hooks.dispatch(revReq);
      recordDispatch(record, revReq, revAt, rev);
      const transcript = rev.transcript ?? "";
      // What the reviewer CLAIMS (runner/Verdict.ts), then what survives
      // mechanical verification against the retained transcript. Two steps on
      // purpose: declaring is how a judgment is stated, verifying is how it is
      // believed, and absence still fails closed to indeterminate.
      const claim = reviewClaim({ status: rev.status, transcript, notes: rev.notes });
      const verdict = resolveVerdict({ ...claim, transcript });
      record.verdict = verdict;
      // Record the quote ONLY when verification actually stood it up. The report
      // captions evidenceQuote as "the runner's own words — quote-verified
      // against the retained transcript" (D14: the report never paraphrases a
      // verdict), so persisting a quote the verifier rejected would put
      // fabricated words under a caption asserting they were checked.
      if (verdict === claim.claimed && claim.quote.trim().length > 0) {
        record.evidenceQuote = claim.quote;
      }

      if (verdict !== "accept") {
        // Honest partial: landing exists but review did not accept.
        if (landing && verdict === "indeterminate") {
          const path = yield* Effect.sync(() =>
            writeContinuationBrief({
              taskId,
              worktree,
              whatExists: [`landing commit ${landing}`],
              remaining: ["resolve review indeterminate — re-read the transcript"],
            }),
          );
          record.continuationPath = path;
          record.outcome = "partial";
          // Partial with landing under park-on-issue → hold; autonomous continues.
          return yield* finishFailure(run, record, `review verdict ${verdict}`, landing);
        }
        return yield* finishFailure(run, record, `review verdict ${verdict}`, landing);
      }
    }

    // Accepted path — complete with evidence.
    const evidence = record.evidenceQuote
      ? `verdict accept; quote-verified: ${record.evidenceQuote.slice(0, 200)}`
      : `implementer ${impl.jobId} succeeded` + (landing ? `; landed ${landing}` : "");
    yield* completeTask(taskId, { evidence });
    record.outcome = "accepted";
    return { record };
  });

const findRun = (idOrSlug: string): Effect.Effect<Run, StoreError | OpError, Ledger> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const run = (yield* ledger.loadRuns).find((r) => r.id === idOrSlug || r.slug === idOrSlug);
    if (!run) return yield* missing(`no run ${idOrSlug}`);
    return run;
  });

/** The run `POST /v1/runs/:id/execute` would drive, or the reason it will not.
 *  Split out of `executeRun` so a surface can refuse a missing or finished run
 *  before it consults the machine for a harness. */
export const runForExecute = (idOrSlug: string): Effect.Effect<Run, StoreError | OpError, Ledger> =>
  Effect.gen(function* () {
    const run = yield* findRun(idOrSlug);
    if (run.status !== "approved" && run.status !== "running") {
      return yield* conflict(`run ${run.id} is ${run.status} — only approved/running runs execute`);
    }
    return run;
  });

/** `quirks run --resume <name|id>` — the run is the unit of resumability, so the
 *  refusals are about the RUN's state, not any one task's. */
export const runForResume = (idOrSlug: string): Effect.Effect<Run, StoreError | OpError, Ledger> =>
  Effect.gen(function* () {
    const run = yield* findRun(idOrSlug).pipe(
      Effect.catchTag("NotFoundError", () =>
        missing(`no run ${idOrSlug} — quirks run list shows what exists`),
      ),
    );
    if (run.status === "completed") {
      return yield* conflict(`run ${run.id} is already completed — nothing to resume`);
    }
    if (run.status === "abandoned") {
      return yield* conflict(`run ${run.id} is abandoned — nothing to resume`);
    }
    if (run.status === "planned") {
      return yield* conflict(
        `run ${run.id} is only planned — approve it with quirks run --yes first`,
      );
    }
    // approved or running — executeRun handles both.
    return run;
  });

export interface ExecuteResult {
  readonly run: RunExecution;
}

/** Walk an approved/running run in dependency order; failures block dependents only.
 *  Resume-safe: settled outcomes are skipped; pending/released/partial/running retry. */
export const executeRun = (
  idOrSlug: string,
  hooks: ParentHooks,
): Effect.Effect<ExecuteResult, RunError, Ledger | Store> =>
  Effect.gen(function* () {
    const loaded = yield* runForExecute(idOrSlug);

    const exec = ensureExecution(loaded);
    const now = new Date().toISOString();
    exec.status = "running";
    exec.startedAt = exec.startedAt ?? now;
    exec.updatedAt = now;
    // A previous incomplete finalize may have left a completedAt — clear it.
    delete exec.completedAt;
    yield* saveExecution(exec);

    const failedIds = new Set<string>(
      exec.tasks
        .filter((t) => ["failed", "blocked", "held", "released"].includes(t.outcome))
        .map((t) => t.taskId),
    );

    for (const taskId of exec.taskIds) {
      const rec = exec.tasks.find((t) => t.taskId === taskId);
      if (!rec) continue;
      if (!shouldAttemptOnResume(rec.outcome)) continue;

      // If any dependency in this run failed/held/released/blocked, skip.
      const task = yield* getTask(taskId);
      const unmet = task.dependsOn.filter((d) => exec.taskIds.includes(d) && failedIds.has(d));
      if (unmet.length > 0) {
        rec.outcome = "blocked";
        rec.reason = `blocked by failed dependency: ${unmet.join(", ")}`;
        if (task.status === "open" || task.status === "claimed") {
          yield* blockTask(taskId, { reason: rec.reason }).pipe(Effect.ignore);
        }
        failedIds.add(taskId);
        exec.updatedAt = new Date().toISOString();
        yield* saveExecution(exec);
        continue;
      }

      // Released tasks are open again; anything we still hold must be let go
      // before it can be claimed again.
      //
      // The state this guard missed: `runParent` claims, then dispatches for up
      // to thirty minutes, and merges the record back only AFTER it returns — so
      // `running` is never written to disk. A crash mid-dispatch therefore
      // leaves the ledger task `claimed` while the record still says `pending`,
      // which the old condition (partial|running) did not cover. `claim()`
      // refuses anything but `open`, so the error escaped `executeRun` entirely:
      // every healthy task behind the crashed one was never attempted, and
      // `--resume` returned the same 409 forever until someone ran
      // `quirks task release` by hand.
      //
      // Only OUR OWN claim is released. Another run holding it is a real
      // conflict and must stay one — `shouldAttemptOnResume` has already ruled
      // out the settled outcomes, so this is exactly the stale-claim case.
      if (task.status === "claimed" && task.statusDetail.claimedBy === `run:${exec.id}`) {
        yield* releaseTask(taskId).pipe(Effect.ignore);
      }

      // Dispatch history accumulates across resume — a re-attempt appends, it does
      // not erase the attempt that failed last night.
      const priorDispatches = rec.dispatches ?? [];
      const { record, decision } = yield* runParent(exec, taskId, hooks);
      Object.assign(rec, record);
      rec.dispatches = [...priorDispatches, ...(record.dispatches ?? [])];
      if (record.outcome !== "accepted" && decision !== undefined) {
        failedIds.add(taskId);
        for (const dep of decision.blockDependents) {
          failedIds.add(dep);
          const depRec = exec.tasks.find((t) => t.taskId === dep);
          if (depRec && shouldAttemptOnResume(depRec.outcome)) {
            depRec.outcome = "blocked";
            depRec.reason = `blocked by ${taskId}`;
            const depTask = yield* getTask(dep).pipe(Effect.option);
            const status = depTask._tag === "Some" ? depTask.value.status : undefined;
            if (status === "open" || status === "claimed") {
              yield* blockTask(dep, { reason: depRec.reason }).pipe(Effect.ignore);
            }
          }
        }
      }
      exec.updatedAt = new Date().toISOString();
      yield* saveExecution(exec);
    }

    // Durable completion — never report completed on a lie (QK-CTL-012).
    yield* finalizeRun(exec);
    return { run: exec };
  });

/** `quirks run --resume <name|id>` — same execute path, picks up where it stopped. */
export const resumeRun = (
  idOrSlug: string,
  hooks: ParentHooks,
): Effect.Effect<ExecuteResult, RunError, Ledger | Store> =>
  Effect.flatMap(runForResume(idOrSlug), (run) => executeRun(run.id, hooks));
