// QK-RUN-006 — resume + durable completion (QK-CTL-012 class).
// Ported from the bun-era test/resume.test.ts (QK-MONO-005).
//
// The carried defect this file exists for: completion held in memory only is a
// lie. A run may not report itself completed unless the ledger actually shows
// the transitions it claims.
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import {
  durableCompletionErrors,
  executeRun,
  finalizeRun,
  resumeRun,
  shouldAttemptOnResume,
  type RunExecution,
} from "./Parent.ts";
import { completeTask, getTask, proposeTask, type ProposeInput } from "../ops/Tasks.ts";
import { startRun } from "../ops/Runs.ts";
import { Ledger } from "../store/Store.ts";
import { dispatched, fakeHooks, runOp, runOpError, tempRoot } from "../testing/Harness.ts";

const propose = (overrides: Partial<ProposeInput> & { title: string }): ProposeInput => ({
  dependsOn: [],
  deliverables: [],
  criteria: [],
  verify: [],
  sources: [],
  needsDesign: false,
  needsBreakdown: false,
  future: false,
  ...overrides,
});

describe("shouldAttemptOnResume", () => {
  it("retries pending/released/partial/running; skips settled", () => {
    expect(shouldAttemptOnResume("pending")).toBe(true);
    expect(shouldAttemptOnResume("released")).toBe(true);
    expect(shouldAttemptOnResume("partial")).toBe(true);
    expect(shouldAttemptOnResume("running")).toBe(true);
    expect(shouldAttemptOnResume("accepted")).toBe(false);
    expect(shouldAttemptOnResume("blocked")).toBe(false);
    expect(shouldAttemptOnResume("held")).toBe(false);
    expect(shouldAttemptOnResume("failed")).toBe(false);
  });
});

describe("durable completion", () => {
  it("refuses to report completed when the ledger disagrees (QK-CTL-012)", async () => {
    const root = tempRoot("quirks-resume-");
    const seeded = await runOp(
      root,
      Effect.gen(function* () {
        const t = yield* proposeTask(propose({ title: "t" }));
        const started = yield* startRun({ name: "lie", taskIds: [t.id], yes: true });
        if (started.dryRun) throw new Error("unreachable");
        const exec: RunExecution = {
          ...started.run,
          status: "running",
          tasks: [
            {
              taskId: t.id,
              outcome: "accepted", // lie — ledger is still open
              landingCommit: null,
              worktree: null,
            },
          ],
        };
        return { exec, id: t.id, errors: yield* durableCompletionErrors(exec) };
      }),
    );
    expect(seeded.errors).toEqual([`${seeded.id}: run says accepted but ledger is open`]);

    const refusal = await runOpError(root, finalizeRun(seeded.exec));
    expect(refusal.message).toMatch(/durable completion failed/);

    // And the refusal is durable too: the persisted run stays running, with no
    // completedAt to read back as success.
    const persisted = await runOp(
      root,
      Effect.gen(function* () {
        const ledger = yield* Ledger;
        return (yield* ledger.loadRuns).find((r) => r.id === seeded.exec.id);
      }),
    );
    expect(persisted?.status).toBe("running");
    expect(persisted?.completedAt).toBeUndefined();
  });

  it("completes only when accepted tasks are actually completed in the ledger", async () => {
    const root = tempRoot("quirks-resume-");
    const done = await runOp(
      root,
      Effect.gen(function* () {
        const t = yield* proposeTask(propose({ title: "t" }));
        const started = yield* startRun({ name: "honest", taskIds: [t.id], yes: true });
        if (started.dryRun) throw new Error("unreachable");
        yield* completeTask(t.id, { evidence: "done" });
        const exec: RunExecution = {
          ...started.run,
          status: "running",
          tasks: [{ taskId: t.id, outcome: "accepted", landingCommit: null, worktree: null }],
        };
        return yield* finalizeRun(exec);
      }),
    );
    expect(done.status).toBe("completed");
    expect(done.completedAt).toBeTruthy();
  });
});

describe("resumeRun", () => {
  it("picks up where an interrupted run stopped — skips accepted, runs pending", async () => {
    const root = tempRoot("quirks-resume-");
    const dispatchedTasks: string[] = [];
    const result = await runOp(
      root,
      Effect.gen(function* () {
        const ledger = yield* Ledger;
        const a = yield* proposeTask(propose({ title: "a" }));
        const b = yield* proposeTask(propose({ title: "b" }));
        const started = yield* startRun({
          name: "interrupted",
          taskIds: [a.id, b.id],
          yes: true,
          mode: "autonomous",
        });
        if (started.dryRun) throw new Error("unreachable");

        // Simulate: A accepted and persisted mid-run; B still pending; status running.
        yield* completeTask(a.id, { evidence: "first half" });
        const runs = yield* ledger.loadRuns;
        const idx = runs.findIndex((r) => r.id === started.run.id);
        runs[idx] = {
          ...started.run,
          status: "running",
          startedAt: new Date().toISOString(),
          tasks: [
            { taskId: a.id, outcome: "accepted", landingCommit: null, worktree: null },
            { taskId: b.id, outcome: "pending", landingCommit: null, worktree: null },
          ],
        };
        yield* ledger.saveRuns(runs);

        const { run } = yield* resumeRun(
          "interrupted",
          fakeHooks({
            review: false,
            dispatch: (req) => {
              dispatchedTasks.push(req.taskId);
              return dispatched(`ok-${req.taskId}`);
            },
          }),
        );
        return { run, ids: { a: a.id, b: b.id }, bStatus: (yield* getTask(b.id)).status };
      }),
    );

    expect(dispatchedTasks).toEqual([result.ids.b]); // A skipped
    expect(result.run.status).toBe("completed");
    expect(result.run.tasks.find((t) => t.taskId === result.ids.a)?.outcome).toBe("accepted");
    expect(result.run.tasks.find((t) => t.taskId === result.ids.b)?.outcome).toBe("accepted");
    expect(result.bStatus).toBe("completed");
  });

  it("resume of an already-completed run is refused", async () => {
    const root = tempRoot("quirks-resume-");
    const error = await runOpError(
      root,
      Effect.gen(function* () {
        const t = yield* proposeTask(propose({ title: "t" }));
        const started = yield* startRun({ name: "done-run", taskIds: [t.id], yes: true });
        if (started.dryRun) throw new Error("unreachable");
        yield* executeRun(started.run.id, fakeHooks({ review: false }));
        return yield* resumeRun("done-run", fakeHooks({ review: false }));
      }),
    );
    expect(error.message).toMatch(/already completed/);
  });
});
