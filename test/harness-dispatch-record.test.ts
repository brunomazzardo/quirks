// QK-HARN-001 — the dispatch record `quirks harness` derives liveness from.
// Without this, "did codex answer tonight" has no source but prose. The record is
// written for failures too (that is where a quota refusal lives), and it must
// survive resume rather than being overwritten by the retry.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeRun, type ParentHooks } from "../src/run/parent.ts";
import { createGoal } from "../src/ops/goals.ts";
import { proposeTask } from "../src/ops/tasks.ts";
import { startRun } from "../src/ops/runs.ts";
import { loadRuns, saveRuns, type Store } from "../src/store/store.ts";
import { deriveLiveness } from "../src/harness/liveness.ts";
import { harnessView } from "../src/ops/harness.ts";
import type { DispatchResult } from "../src/runner/types.ts";

function store(): Store {
  const root = mkdtempSync(join(tmpdir(), "quirks-hdr-"));
  return { root, dir: join(root, ".quirks") };
}

function ok(jobId: string): DispatchResult {
  return {
    jobId,
    runner: "claude",
    status: "success",
    exitCode: 0,
    transcriptPath: null,
    durationMs: 5,
  };
}

function oneTaskRun(s: Store, name: string, mode: "autonomous" | "park-on-issue" = "autonomous") {
  createGoal(s, { id: "QK-HD", title: "hd", why: "w", doneWhen: [] });
  const t = proposeTask(s, {
    title: "a", goal: "QK-HD", dependsOn: [], deliverables: [], criteria: [],
    verify: [], sources: [], needsDesign: false, needsBreakdown: false, future: false,
  });
  const started = startRun(s, { name, taskIds: [t.id], yes: true, mode });
  if (started.dryRun) throw new Error("unreachable");
  return { taskId: t.id, runId: started.run.id };
}

describe("dispatch records", () => {
  test("a successful run records the implementer dispatch with runner, model, and a date", async () => {
    const s = store();
    const { taskId, runId } = oneTaskRun(s, "records");
    const hooks: ParentHooks = {
      implementer: { runner: "claude", model: "sonnet" },
      review: false,
      detectLandingCommit: () => null,
      dispatch: async () => ok("j1"),
    };

    const { run } = await executeRun(s, runId, hooks);
    const dispatches = run.tasks!.find((t) => t.taskId === taskId)!.dispatches!;
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.runner).toBe("claude");
    expect(dispatches[0]!.model).toBe("sonnet");
    expect(dispatches[0]!.role).toBe("implementer");
    expect(dispatches[0]!.status).toBe("success");
    expect(dispatches[0]!.exitCode).toBe(0);
    // A real timestamp — the thing the checked-in prose date could not be.
    expect(Number.isNaN(Date.parse(dispatches[0]!.dispatchedAt))).toBe(false);
  });

  test("records both roles when review runs, in order", async () => {
    const s = store();
    const { taskId, runId } = oneTaskRun(s, "two-roles");
    const hooks: ParentHooks = {
      implementer: { runner: "claude", model: "sonnet" },
      reviewer: { runner: "codex", model: "gpt-5.6-terra" },
      review: true,
      detectLandingCommit: () => null,
      dispatch: async (req) => ({
        ...ok(`j-${req.role}`),
        ...(req.role === "reviewer"
          ? { notes: ["quote:The change is correct."], transcript: "The change is correct." }
          : {}),
      }),
    };

    const { run } = await executeRun(s, runId, hooks);
    const dispatches = run.tasks!.find((t) => t.taskId === taskId)!.dispatches!;
    expect(dispatches.map((d) => d.role)).toEqual(["implementer", "reviewer"]);
    expect(dispatches[1]!.runner).toBe("codex");
    expect(dispatches[1]!.model).toBe("gpt-5.6-terra");
  });

  test("a failed dispatch is recorded WITH the runner's own words", async () => {
    const s = store();
    const { taskId, runId } = oneTaskRun(s, "quota");
    const hooks: ParentHooks = {
      implementer: { runner: "codex", model: "gpt-5.5" },
      review: false,
      detectLandingCommit: () => null,
      dispatch: async () => ({
        jobId: "j1",
        runner: "codex",
        status: "failure",
        exitCode: 1,
        transcriptPath: null,
        durationMs: 3,
        failure: { code: "non_zero_exit", message: "runner exited 1: usage limit reached" },
      }),
    };

    const { run } = await executeRun(s, runId, hooks);
    const dispatch = run.tasks!.find((t) => t.taskId === taskId)!.dispatches![0]!;
    expect(dispatch.status).toBe("failure");
    expect(dispatch.failureCode).toBe("non_zero_exit");
    expect(dispatch.failureMessage).toContain("usage limit reached");
  });

  test("records are durable, and harness liveness reads them back", async () => {
    const s = store();
    const { runId } = oneTaskRun(s, "durable");
    await executeRun(s, runId, {
      implementer: { runner: "codex", model: "gpt-5.5" },
      review: false,
      detectLandingCommit: () => null,
      dispatch: async () => ({ ...ok("j1"), runner: "codex" }),
    });

    // Reload from disk — not from the in-memory execution result.
    const liveness = deriveLiveness(loadRuns(s));
    const codex = liveness.find((l) => l.runner === "codex")!;
    expect(codex.state).toBe("answered");
    expect(codex.observed).toBe(1);

    // And it reaches the assembled view, where claude stays unproven.
    const view = await harnessView(s);
    expect(view.harnesses.find((h) => h.runner === "codex")!.liveness).toBe("answered");
    expect(view.harnesses.find((h) => h.runner === "claude")!.liveness).toBe("never-dispatched");
  });

  test("resume appends — last night's failed attempt is not erased by tonight's retry", async () => {
    const s = store();
    const { taskId, runId } = oneTaskRun(s, "resumed", "park-on-issue");

    // Seed an interrupted run the way test/resume.test.ts does: the task was
    // released after a failed dispatch, and that dispatch is on the record.
    const runs = loadRuns(s);
    const idx = runs.findIndex((r) => r.id === runId);
    runs[idx] = {
      ...runs[idx]!,
      status: "running",
      startedAt: new Date().toISOString(),
      tasks: [
        {
          taskId,
          outcome: "released",
          landingCommit: null,
          worktree: null,
          dispatches: [
            {
              runner: "claude",
              role: "implementer",
              model: "sonnet",
              dispatchedAt: "2026-07-27T23:00:00.000Z",
              status: "failure",
              exitCode: 1,
              durationMs: 1,
              failureCode: "non_zero_exit",
              failureMessage: "first attempt boom",
            },
          ],
        },
      ],
    };
    saveRuns(s, runs);

    // Retry succeeds.
    const { run } = await executeRun(s, runId, {
      implementer: { runner: "claude", model: "sonnet" },
      review: false,
      detectLandingCommit: () => null,
      dispatch: async () => ok("j2"),
    });

    const dispatches = run.tasks!.find((t) => t.taskId === taskId)!.dispatches!;
    expect(dispatches).toHaveLength(2);
    expect(dispatches[0]!.status).toBe("failure");
    expect(dispatches[0]!.failureMessage).toContain("first attempt boom");
    expect(dispatches[1]!.status).toBe("success");
    // Newest wins for liveness, but the history is still there to read.
    expect(deriveLiveness(loadRuns(s)).find((l) => l.runner === "claude")!.state).toBe("answered");
    expect(deriveLiveness(loadRuns(s)).find((l) => l.runner === "claude")!.observed).toBe(2);
  });
});
