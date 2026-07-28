// QK-RUN-005 — failure policy, continuation, parent loop, run execution.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideFailure, dependentsOf } from "../src/run/failure-policy.ts";
import { writeContinuationBrief } from "../src/run/continuation.ts";
import {
  assertDifferentReviewModel,
  executeRun,
  runParent,
  type ParentHooks,
} from "../src/run/parent.ts";
import { createGoal } from "../src/ops/goals.ts";
import { proposeTask, getTask } from "../src/ops/tasks.ts";
import { startRun } from "../src/ops/runs.ts";
import type { Store } from "../src/store/store.ts";
import type { DispatchResult } from "../src/runner/types.ts";

function store(): Store {
  const root = mkdtempSync(join(tmpdir(), "quirks-parent-"));
  return { root, dir: join(root, ".quirks") };
}

describe("dependentsOf / decideFailure", () => {
  const deps = new Map<string, readonly string[]>([
    ["A", []],
    ["B", ["A"]],
    ["C", ["B"]],
    ["D", []],
  ]);

  test("a failed task blocks dependents, not siblings", () => {
    expect(dependentsOf("A", ["A", "B", "C", "D"], deps)).toEqual(["B", "C"]);
    expect(dependentsOf("D", ["A", "B", "C", "D"], deps)).toEqual([]);
  });

  test("park-on-issue: no landing → release; with landing → hold", () => {
    const release = decideFailure({
      mode: "park-on-issue",
      failedId: "A",
      landingCommit: null,
      taskIds: ["A", "B"],
      dependsOn: deps,
    });
    expect(release.action).toBe("release");
    expect(release.blockDependents).toEqual(["B"]);

    const hold = decideFailure({
      mode: "park-on-issue",
      failedId: "A",
      landingCommit: "abc123",
      taskIds: ["A", "B"],
      dependsOn: deps,
    });
    expect(hold.action).toBe("hold");
    expect(hold.reason).toContain("never unassigning");
  });

  test("autonomous continues but still blocks dependents", () => {
    const d = decideFailure({
      mode: "autonomous",
      failedId: "A",
      landingCommit: null,
      taskIds: ["A", "B", "C"],
      dependsOn: deps,
    });
    expect(d.action).toBe("continue");
    expect(d.blockDependents).toEqual(["B", "C"]);
  });
});

describe("continuation brief", () => {
  test("writes into the worktree and says do not redo groundwork", () => {
    const wt = mkdtempSync(join(tmpdir(), "quirks-cont-"));
    const path = writeContinuationBrief({
      taskId: "QK-X-001",
      worktree: wt,
      whatExists: ["commit deadbeef — tests green"],
      remaining: ["wire the report route", "update the brief"],
    });
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, "utf8");
    expect(body).toContain("Do not redo groundwork");
    expect(body).toContain("commit deadbeef");
    expect(body).toContain("1. wire the report route");
  });
});

describe("assertDifferentReviewModel", () => {
  test("same model is refused", () => {
    expect(() => assertDifferentReviewModel("sonnet", "sonnet")).toThrow(/differ/);
    expect(() => assertDifferentReviewModel("sonnet", "opus")).not.toThrow();
  });
});

function okDispatch(jobId: string, extra?: Partial<DispatchResult> & { transcript?: string }) {
  return async (): Promise<DispatchResult & { transcript?: string }> => ({
    jobId,
    runner: "claude",
    status: "success",
    exitCode: 0,
    transcriptPath: null,
    durationMs: 1,
    ...extra,
  });
}

describe("executeRun", () => {
  test("failed task blocks dependents; sibling continues; run completes", async () => {
    const s = store();
    createGoal(s, { id: "QK-EX", title: "ex", why: "w", doneWhen: [] });
    const a = proposeTask(s, {
      title: "a", goal: "QK-EX", dependsOn: [], deliverables: [], criteria: [],
      verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
    });
    const b = proposeTask(s, {
      title: "b", goal: "QK-EX", dependsOn: [a.id], deliverables: [], criteria: [],
      verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
    });
    const d = proposeTask(s, {
      title: "d", goal: "QK-EX", dependsOn: [], deliverables: [], criteria: [],
      verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
    });
    const started = startRun(s, {
      name: "block-deps",
      taskIds: [a.id, b.id, d.id],
      yes: true,
      mode: "autonomous",
    });
    if (started.dryRun) throw new Error("unreachable");

    let calls = 0;
    const hooks: ParentHooks = {
      implementer: { runner: "claude", model: "sonnet" },
      reviewer: { runner: "claude", model: "opus" },
      review: false,
      detectLandingCommit: () => null,
      dispatch: async (req) => {
        calls += 1;
        if (req.taskId === a.id) {
          return {
            jobId: "fail-a",
            runner: "claude",
            status: "failure",
            exitCode: 1,
            transcriptPath: null,
            durationMs: 1,
            failure: { code: "non_zero_exit", message: "boom" },
          };
        }
        return okDispatch(`ok-${req.taskId}`)();
      },
    };

    const { run } = await executeRun(s, started.run.id, hooks);
    expect(run.status).toBe("completed");
    const byId = Object.fromEntries(run.tasks!.map((t) => [t.taskId, t]));
    expect(byId[a.id]?.outcome).toBe("failed");
    expect(byId[b.id]?.outcome).toBe("blocked");
    expect(byId[d.id]?.outcome).toBe("accepted");
    expect(getTask(s, b.id).status).toBe("blocked");
    expect(getTask(s, d.id).status).toBe("completed");
    expect(calls).toBe(2); // a failed, d ran; b never dispatched
  });

  test("park-on-issue releases pre-landing and holds after landing", async () => {
    const s = store();
    const t = proposeTask(s, {
      title: "one", dependsOn: [], deliverables: [], criteria: [],
      verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
    });
    const started = startRun(s, { name: "phase", taskIds: [t.id], yes: true, mode: "park-on-issue" });
    if (started.dryRun) throw new Error("unreachable");

    // Pre-landing failure → release.
    const pre = await runParent(s, { ...started.run, tasks: [{ taskId: t.id, outcome: "pending", landingCommit: null, worktree: null }] }, t.id, {
      implementer: { runner: "claude", model: "sonnet" },
      review: false,
      detectLandingCommit: () => null,
      dispatch: async () => ({
        jobId: "x", runner: "claude", status: "failure", exitCode: 1,
        transcriptPath: null, durationMs: 1,
        failure: { code: "non_zero_exit", message: "no" },
      }),
    });
    expect(pre.record.outcome).toBe("released");
    expect(getTask(s, t.id).status).toBe("open");

    // Re-claim path: propose a second task for the hold case.
    const t2 = proposeTask(s, {
      title: "two", dependsOn: [], deliverables: [], criteria: [],
      verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
    });
    const started2 = startRun(s, { name: "phase-hold", taskIds: [t2.id], yes: true, mode: "park-on-issue" });
    if (started2.dryRun) throw new Error("unreachable");
    const post = await runParent(
      s,
      { ...started2.run, tasks: [{ taskId: t2.id, outcome: "pending", landingCommit: null, worktree: null }] },
      t2.id,
      {
        implementer: { runner: "claude", model: "sonnet" },
        reviewer: { runner: "claude", model: "opus" },
        review: true,
        detectLandingCommit: () => "landed111",
        dispatch: async (req) => {
          if (req.role === "implementer") return okDispatch("impl")();
          // Reviewer "accepts" with no quote → indeterminate after landing → hold.
          return {
            jobId: "rev", runner: "claude", status: "success", exitCode: 0,
            transcriptPath: null, durationMs: 1, transcript: "no judgment here",
          };
        },
      },
    );
    expect(post.record.landingCommit).toBe("landed111");
    expect(post.record.outcome).toBe("held");
    expect(getTask(s, t2.id).status).toBe("blocked");
    expect(getTask(s, t2.id).statusDetail.blockedReason).toContain("never unassigning");
  });

  test("accepted path completes the task; reviewer model must differ", async () => {
    const s = store();
    const t = proposeTask(s, {
      title: "ok", dependsOn: [], deliverables: [], criteria: [],
      verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
    });
    const started = startRun(s, { name: "accept", taskIds: [t.id], yes: true, mode: "autonomous" });
    if (started.dryRun) throw new Error("unreachable");

    const quote = "Accept as it stands. I found nothing that must be fixed first.";
    const transcript = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: quote }] },
    });

    const { run } = await executeRun(s, started.run.id, {
      implementer: { runner: "claude", model: "sonnet" },
      reviewer: { runner: "claude", model: "opus" },
      review: true,
      detectLandingCommit: () => "abc",
      dispatch: async (req) => {
        if (req.role === "implementer") return okDispatch("impl")();
        return {
          jobId: "rev", runner: "claude", status: "success", exitCode: 0,
          transcriptPath: null, durationMs: 1, transcript,
          notes: [`quote:${quote}`],
        };
      },
    });
    expect(run.tasks![0]?.outcome).toBe("accepted");
    expect(getTask(s, t.id).status).toBe("completed");
  });
});
