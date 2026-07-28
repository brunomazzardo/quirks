// QK-RUN-006 — resume + durable completion (QK-CTL-012 class).
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  durableCompletionErrors,
  executeRun,
  finalizeRun,
  resumeRun,
  shouldAttemptOnResume,
  type ParentHooks,
  type RunExecution,
} from "../src/run/parent.ts";
import { proposeTask, getTask, completeTask } from "../src/ops/tasks.ts";
import { startRun } from "../src/ops/runs.ts";
import { loadRuns, saveRuns, type Store } from "../src/store/store.ts";
import type { DispatchResult } from "../src/runner/types.ts";

function store(): Store {
  const root = mkdtempSync(join(tmpdir(), "quirks-resume-"));
  return { root, dir: join(root, ".quirks") };
}

function ok(jobId: string): Promise<DispatchResult & { transcript?: string }> {
  return Promise.resolve({
    jobId,
    runner: "claude",
    status: "success",
    exitCode: 0,
    transcriptPath: null,
    durationMs: 1,
  });
}

describe("shouldAttemptOnResume", () => {
  test("retries pending/released/partial/running; skips settled", () => {
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
  test("refuses to report completed when ledger disagrees (QK-CTL-012)", () => {
    const s = store();
    const t = proposeTask(s, {
      title: "t", dependsOn: [], deliverables: [], criteria: [],
      verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
    });
    const started = startRun(s, { name: "lie", taskIds: [t.id], yes: true });
    if (started.dryRun) throw new Error("unreachable");

    const exec: RunExecution = {
      ...started.run,
      status: "running",
      tasks: [{
        taskId: t.id,
        outcome: "accepted", // lie — ledger is still open
        landingCommit: null,
        worktree: null,
      }],
    };
    expect(durableCompletionErrors(s, exec)).toEqual([
      `${t.id}: run says accepted but ledger is open`,
    ]);
    expect(() => finalizeRun(s, exec)).toThrow(/durable completion failed/);
    expect(loadRuns(s).find((r) => r.id === exec.id)!.status).toBe("running");
    expect(loadRuns(s).find((r) => r.id === exec.id)!.completedAt).toBeUndefined();
  });

  test("completes only when accepted tasks are actually completed in the ledger", () => {
    const s = store();
    const t = proposeTask(s, {
      title: "t", dependsOn: [], deliverables: [], criteria: [],
      verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
    });
    const started = startRun(s, { name: "honest", taskIds: [t.id], yes: true });
    if (started.dryRun) throw new Error("unreachable");
    completeTask(s, t.id, { evidence: "done" });

    const exec: RunExecution = {
      ...started.run,
      status: "running",
      tasks: [{
        taskId: t.id,
        outcome: "accepted",
        landingCommit: null,
        worktree: null,
      }],
    };
    const done = finalizeRun(s, exec);
    expect(done.status).toBe("completed");
    expect(done.completedAt).toBeTruthy();
  });
});

describe("resumeRun", () => {
  test("picks up where an interrupted run stopped — skips accepted, runs pending", async () => {
    const s = store();
    const a = proposeTask(s, {
      title: "a", dependsOn: [], deliverables: [], criteria: [],
      verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
    });
    const b = proposeTask(s, {
      title: "b", dependsOn: [], deliverables: [], criteria: [],
      verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
    });
    const started = startRun(s, {
      name: "interrupted",
      taskIds: [a.id, b.id],
      yes: true,
      mode: "autonomous",
    });
    if (started.dryRun) throw new Error("unreachable");

    // Simulate: A accepted and persisted mid-run; B still pending; status running.
    completeTask(s, a.id, { evidence: "first half" });
    const runs = loadRuns(s);
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
    saveRuns(s, runs);

    const dispatched: string[] = [];
    const hooks: ParentHooks = {
      implementer: { runner: "claude", model: "sonnet" },
      review: false,
      detectLandingCommit: () => null,
      dispatch: async (req) => {
        dispatched.push(req.taskId);
        return ok(`ok-${req.taskId}`);
      },
    };

    const { run } = await resumeRun(s, "interrupted", hooks);
    expect(dispatched).toEqual([b.id]); // A skipped
    expect(run.status).toBe("completed");
    expect(run.tasks!.find((t) => t.taskId === a.id)?.outcome).toBe("accepted");
    expect(run.tasks!.find((t) => t.taskId === b.id)?.outcome).toBe("accepted");
    expect(getTask(s, b.id).status).toBe("completed");
  });

  test("resume of an already-completed run is refused", async () => {
    const s = store();
    const t = proposeTask(s, {
      title: "t", dependsOn: [], deliverables: [], criteria: [],
      verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
    });
    const started = startRun(s, { name: "done-run", taskIds: [t.id], yes: true });
    if (started.dryRun) throw new Error("unreachable");
    await executeRun(s, started.run.id, {
      implementer: { runner: "claude", model: "sonnet" },
      review: false,
      detectLandingCommit: () => null,
      dispatch: async () => ok("x"),
    });
    await expect(resumeRun(s, "done-run", {
      implementer: { runner: "claude", model: "sonnet" },
      review: false,
      detectLandingCommit: () => null,
      dispatch: async () => ok("y"),
    })).rejects.toThrow(/already completed/);
  });
});
