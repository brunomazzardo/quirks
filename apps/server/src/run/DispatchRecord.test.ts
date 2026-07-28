// QK-HARN-001 — the dispatch record `quirks harness` derives liveness from.
// Ported from the bun-era test/harness-dispatch-record.test.ts (QK-MONO-005).
//
// Without this, "did codex answer tonight" has no source but prose. The record is
// written for failures too (that is where a quota refusal lives), and it must
// survive resume rather than being overwritten by the retry.
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { executeRun } from "./Parent.ts";
import { createGoal } from "../ops/Goals.ts";
import { proposeTask, type ProposeInput } from "../ops/Tasks.ts";
import { startRun } from "../ops/Runs.ts";
import { harnessView } from "../ops/Harness.ts";
import { deriveLiveness } from "../harness/Liveness.ts";
import { Ledger } from "../store/Store.ts";
import { dispatched, fakeHooks, runOp, tempRoot } from "../testing/Harness.ts";
import type { RunMode, RunTaskRecord } from "@quirks/contracts";

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

const oneTaskRun = (name: string, mode: RunMode = "autonomous") =>
  Effect.gen(function* () {
    yield* createGoal({ id: "QK-HD", title: "hd", why: "w", doneWhen: [] });
    const t = yield* proposeTask(propose({ title: "a", goal: "QK-HD" }));
    const started = yield* startRun({ name, taskIds: [t.id], yes: true, mode });
    if (started.dryRun) throw new Error("unreachable");
    return { taskId: t.id, runId: started.run.id };
  });

const recordFor = (tasks: readonly RunTaskRecord[], taskId: string): RunTaskRecord => {
  const found = tasks.find((t) => t.taskId === taskId);
  if (!found) throw new Error(`no record for ${taskId}`);
  return found;
};

describe("dispatch records", () => {
  it("a successful run records the implementer dispatch with runner, model, and a date", async () => {
    const dispatches = await runOp(
      tempRoot("quirks-hdr-"),
      Effect.gen(function* () {
        const { taskId, runId } = yield* oneTaskRun("records");
        const { run } = yield* executeRun(
          runId,
          fakeHooks({
            implementer: { runner: "claude", model: "sonnet" },
            review: false,
            dispatch: () => dispatched("j1", { durationMs: 5 }),
          }),
        );
        return recordFor(run.tasks, taskId).dispatches ?? [];
      }),
    );
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.runner).toBe("claude");
    expect(dispatches[0]?.model).toBe("sonnet");
    expect(dispatches[0]?.role).toBe("implementer");
    expect(dispatches[0]?.status).toBe("success");
    expect(dispatches[0]?.exitCode).toBe(0);
    // A real timestamp — the thing the checked-in prose date could not be.
    expect(Number.isNaN(Date.parse(dispatches[0]?.dispatchedAt ?? ""))).toBe(false);
  });

  it("records both roles when review runs, in order", async () => {
    const dispatches = await runOp(
      tempRoot("quirks-hdr-"),
      Effect.gen(function* () {
        const { taskId, runId } = yield* oneTaskRun("two-roles");
        const { run } = yield* executeRun(
          runId,
          fakeHooks({
            implementer: { runner: "claude", model: "sonnet" },
            reviewer: { runner: "codex", model: "gpt-5.6-terra" },
            review: true,
            dispatch: (req) =>
              req.role === "reviewer"
                ? dispatched("j-reviewer", {
                    notes: ["quote:The change is correct."],
                    transcript: "The change is correct.",
                  })
                : dispatched("j-implementer"),
          }),
        );
        return recordFor(run.tasks, taskId).dispatches ?? [];
      }),
    );
    expect(dispatches.map((d) => d.role)).toEqual(["implementer", "reviewer"]);
    expect(dispatches[1]?.runner).toBe("codex");
    expect(dispatches[1]?.model).toBe("gpt-5.6-terra");
  });

  it("a failed dispatch is recorded WITH the runner's own words", async () => {
    const dispatch = await runOp(
      tempRoot("quirks-hdr-"),
      Effect.gen(function* () {
        const { taskId, runId } = yield* oneTaskRun("quota");
        const { run } = yield* executeRun(
          runId,
          fakeHooks({
            implementer: { runner: "codex", model: "gpt-5.5" },
            review: false,
            dispatch: () =>
              dispatched("j1", {
                runner: "codex",
                status: "failure",
                exitCode: 1,
                durationMs: 3,
                failure: {
                  code: "non_zero_exit",
                  message: "runner exited 1: usage limit reached",
                },
              }),
          }),
        );
        return (recordFor(run.tasks, taskId).dispatches ?? [])[0];
      }),
    );
    expect(dispatch?.status).toBe("failure");
    expect(dispatch?.failureCode).toBe("non_zero_exit");
    expect(dispatch?.failureMessage).toContain("usage limit reached");
  });

  it("records are durable, and harness liveness reads them back", async () => {
    const root = tempRoot("quirks-hdr-");
    await runOp(
      root,
      Effect.gen(function* () {
        const { runId } = yield* oneTaskRun("durable");
        yield* executeRun(
          runId,
          fakeHooks({
            implementer: { runner: "codex", model: "gpt-5.5" },
            review: false,
            dispatch: () => dispatched("j1", { runner: "codex" }),
          }),
        );
      }),
    );

    // Reload from disk — not from the in-memory execution result.
    const readBack = await runOp(
      root,
      Effect.gen(function* () {
        const ledger = yield* Ledger;
        const liveness = deriveLiveness(yield* ledger.loadRuns);
        return { liveness, view: yield* harnessView() };
      }),
    );
    const codex = readBack.liveness.find((l) => l.runner === "codex");
    expect(codex?.state).toBe("answered");
    expect(codex?.observed).toBe(1);

    // And it reaches the assembled view, where claude stays unproven.
    expect(readBack.view.harnesses.find((h) => h.runner === "codex")?.liveness).toBe("answered");
    expect(readBack.view.harnesses.find((h) => h.runner === "claude")?.liveness).toBe(
      "never-dispatched",
    );
  });

  it("resume appends — last night's failed attempt is not erased by tonight's retry", async () => {
    const root = tempRoot("quirks-hdr-");
    const result = await runOp(
      root,
      Effect.gen(function* () {
        const ledger = yield* Ledger;
        const { taskId, runId } = yield* oneTaskRun("resumed", "park-on-issue");

        // Seed an interrupted run the way Resume.test.ts does: the task was
        // released after a failed dispatch, and that dispatch is on the record.
        const runs = yield* ledger.loadRuns;
        const idx = runs.findIndex((r) => r.id === runId);
        const seeded = runs[idx];
        if (!seeded) throw new Error("unreachable");
        runs[idx] = {
          ...seeded,
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
        yield* ledger.saveRuns(runs);

        // Retry succeeds.
        const { run } = yield* executeRun(
          runId,
          fakeHooks({ review: false, dispatch: () => dispatched("j2") }),
        );
        const liveness = deriveLiveness(yield* ledger.loadRuns);
        return { dispatches: recordFor(run.tasks, taskId).dispatches ?? [], liveness };
      }),
    );

    expect(result.dispatches).toHaveLength(2);
    expect(result.dispatches[0]?.status).toBe("failure");
    expect(result.dispatches[0]?.failureMessage).toContain("first attempt boom");
    expect(result.dispatches[1]?.status).toBe("success");
    // Newest wins for liveness, but the history is still there to read.
    const claude = result.liveness.find((l) => l.runner === "claude");
    expect(claude?.state).toBe("answered");
    expect(claude?.observed).toBe(2);
  });
});
