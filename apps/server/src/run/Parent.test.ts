// QK-RUN-005 — failure policy, continuation, parent loop, run execution.
// Ported from the bun-era test/parent.test.ts (QK-MONO-005).
//
// Every dispatch here is a fake handed to `ParentHooks.dispatch`. Nothing in
// this file can reach a runner: the hooks return a plain value, and the parent
// loop has no `ChildProcessSpawner` to fall back on.
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { decideFailure, dependentsOf } from "./FailurePolicy.ts";
import { writeContinuationBrief } from "./Continuation.ts";
import { assertDifferentReviewModel, executeRun, runParent } from "./Parent.ts";
import { createGoal } from "../ops/Goals.ts";
import { getTask, proposeTask, type ProposeInput } from "../ops/Tasks.ts";
import { startRun } from "../ops/Runs.ts";
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

describe("dependentsOf / decideFailure", () => {
  const deps = new Map<string, readonly string[]>([
    ["A", []],
    ["B", ["A"]],
    ["C", ["B"]],
    ["D", []],
  ]);

  it("a failed task blocks dependents, not siblings", () => {
    expect(dependentsOf("A", ["A", "B", "C", "D"], deps)).toEqual(["B", "C"]);
    expect(dependentsOf("D", ["A", "B", "C", "D"], deps)).toEqual([]);
  });

  it("park-on-issue: no landing → release; with landing → hold", () => {
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

  it("autonomous continues but still blocks dependents", () => {
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
  it("writes into the worktree and says do not redo groundwork", () => {
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
  it("same model is refused", () => {
    expect(
      Effect.runSync(Effect.flip(assertDifferentReviewModel("sonnet", "sonnet"))).message,
    ).toMatch(/differ/);
    expect(Effect.runSync(Effect.exit(assertDifferentReviewModel("sonnet", "opus")))._tag).toBe(
      "Success",
    );
  });
});

describe("executeRun", () => {
  it("failed task blocks dependents; sibling continues; run completes", async () => {
    const root = tempRoot("quirks-parent-");
    let calls = 0;
    const result = await runOp(
      root,
      Effect.gen(function* () {
        yield* createGoal({ id: "QK-EX", title: "ex", why: "w", doneWhen: [] });
        const a = yield* proposeTask(propose({ title: "a", goal: "QK-EX" }));
        const b = yield* proposeTask(propose({ title: "b", goal: "QK-EX", dependsOn: [a.id] }));
        const d = yield* proposeTask(propose({ title: "d", goal: "QK-EX" }));
        const started = yield* startRun({
          name: "block-deps",
          taskIds: [a.id, b.id, d.id],
          yes: true,
          mode: "autonomous",
        });
        if (started.dryRun) throw new Error("unreachable");

        const hooks = fakeHooks({
          implementer: { runner: "claude", model: "sonnet" },
          reviewer: { runner: "claude", model: "opus" },
          review: false,
          dispatch: (req) => {
            calls += 1;
            return req.taskId === a.id
              ? dispatched("fail-a", {
                  status: "failure",
                  exitCode: 1,
                  failure: { code: "non_zero_exit", message: "boom" },
                })
              : dispatched(`ok-${req.taskId}`);
          },
        });

        const { run } = yield* executeRun(started.run.id, hooks);
        return {
          run,
          ids: { a: a.id, b: b.id, d: d.id },
          bStatus: (yield* getTask(b.id)).status,
          dStatus: (yield* getTask(d.id)).status,
        };
      }),
    );

    expect(result.run.status).toBe("completed");
    const byId = Object.fromEntries(result.run.tasks.map((t) => [t.taskId, t]));
    expect(byId[result.ids.a]?.outcome).toBe("failed");
    expect(byId[result.ids.b]?.outcome).toBe("blocked");
    expect(byId[result.ids.d]?.outcome).toBe("accepted");
    expect(result.bStatus).toBe("blocked");
    expect(result.dStatus).toBe("completed");
    expect(calls).toBe(2); // a failed, d ran; b never dispatched
  });

  it("park-on-issue releases pre-landing", async () => {
    const root = tempRoot("quirks-parent-");
    const result = await runOp(
      root,
      Effect.gen(function* () {
        const t = yield* proposeTask(propose({ title: "one" }));
        const started = yield* startRun({
          name: "phase",
          taskIds: [t.id],
          yes: true,
          mode: "park-on-issue",
        });
        if (started.dryRun) throw new Error("unreachable");

        const pre = yield* runParent(
          {
            ...started.run,
            tasks: [{ taskId: t.id, outcome: "pending", landingCommit: null, worktree: null }],
          },
          t.id,
          fakeHooks({
            review: false,
            dispatch: () =>
              dispatched("x", {
                status: "failure",
                exitCode: 1,
                failure: { code: "non_zero_exit", message: "no" },
              }),
          }),
        );
        return { outcome: pre.record.outcome, status: (yield* getTask(t.id)).status };
      }),
    );
    expect(result.outcome).toBe("released");
    expect(result.status).toBe("open");
  });

  it("park-on-issue holds after a landing, and never unassigns verified work", async () => {
    const root = tempRoot("quirks-parent-");
    const result = await runOp(
      root,
      Effect.gen(function* () {
        const t = yield* proposeTask(propose({ title: "two" }));
        const started = yield* startRun({
          name: "phase-hold",
          taskIds: [t.id],
          yes: true,
          mode: "park-on-issue",
        });
        if (started.dryRun) throw new Error("unreachable");

        const post = yield* runParent(
          {
            ...started.run,
            tasks: [{ taskId: t.id, outcome: "pending", landingCommit: null, worktree: null }],
          },
          t.id,
          fakeHooks({
            implementer: { runner: "claude", model: "sonnet" },
            reviewer: { runner: "claude", model: "opus" },
            review: true,
            landingCommit: "landed111",
            dispatch: (req) =>
              req.role === "implementer"
                ? dispatched("impl")
                : // Reviewer "accepts" with no quote → indeterminate after landing → hold.
                  dispatched("rev", { transcript: "no judgment here" }),
          }),
        );
        const task = yield* getTask(t.id);
        return { record: post.record, status: task.status, detail: task.statusDetail };
      }),
    );
    expect(result.record.landingCommit).toBe("landed111");
    expect(result.record.outcome).toBe("held");
    expect(result.status).toBe("blocked");
    expect(result.detail.blockedReason).toContain("never unassigning");
  });

  it("accepted path completes the task on a quote-verified verdict", async () => {
    const root = tempRoot("quirks-parent-");
    const quote = "Accept as it stands. I found nothing that must be fixed first.";
    const transcript = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: quote }] },
    });

    const result = await runOp(
      root,
      Effect.gen(function* () {
        const t = yield* proposeTask(propose({ title: "ok" }));
        const started = yield* startRun({
          name: "accept",
          taskIds: [t.id],
          yes: true,
          mode: "autonomous",
        });
        if (started.dryRun) throw new Error("unreachable");

        const { run } = yield* executeRun(
          started.run.id,
          fakeHooks({
            implementer: { runner: "claude", model: "sonnet" },
            reviewer: { runner: "claude", model: "opus" },
            review: true,
            landingCommit: "abc",
            dispatch: (req) =>
              req.role === "implementer"
                ? dispatched("impl")
                : dispatched("rev", { transcript, notes: [`quote:${quote}`] }),
          }),
        );
        return { run, status: (yield* getTask(t.id)).status };
      }),
    );
    expect(result.run.tasks[0]?.outcome).toBe("accepted");
    expect(result.run.tasks[0]?.verdict).toBe("accept");
    expect(result.status).toBe("completed");
  });

  // The regression that motivated runner/Verdict.ts. `dispatchRunner` emits only
  // transport notes, so nothing on the real path ever produced the `quote:` note
  // the parent used to read — every review resolved to indeterminate and the
  // default configuration could not complete a single task. These two drive the
  // path a real reviewer actually takes: a declaration in its own transcript,
  // and no notes at all.
  describe("a reviewer that declares its verdict in the transcript", () => {
    const reviewerSaid = (text: string): string =>
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });

    const runReview = (transcript: string) =>
      runOp(
        tempRoot("quirks-parent-"),
        Effect.gen(function* () {
          const t = yield* proposeTask(propose({ title: "declared" }));
          const started = yield* startRun({
            name: "declared",
            taskIds: [t.id],
            yes: true,
            mode: "autonomous",
          });
          if (started.dryRun) throw new Error("unreachable");
          const { run } = yield* executeRun(
            started.run.id,
            fakeHooks({
              implementer: { runner: "claude", model: "sonnet" },
              reviewer: { runner: "claude", model: "opus" },
              review: true,
              landingCommit: "abc",
              dispatch: (req) =>
                req.role === "implementer"
                  ? dispatched("impl")
                  : // No notes — exactly what dispatchRunner returns.
                    dispatched("rev", { transcript }),
            }),
          );
          return { record: run.tasks[0], status: (yield* getTask(t.id)).status };
        }),
      );

    it("completes the task when the evidence is really in its own words", async () => {
      const result = await runReview(
        reviewerSaid(
          [
            "I ran the suite and read the diff.",
            "The change is scope-correct and its tests actually exercise it.",
            "",
            "QUIRKS-VERDICT: accept",
            "QUIRKS-EVIDENCE: The change is scope-correct and its tests actually exercise it.",
          ].join("\n"),
        ),
      );
      expect(result.record?.verdict).toBe("accept");
      expect(result.record?.outcome).toBe("accepted");
      expect(result.status).toBe("completed");
    });

    it("refuses an accept whose evidence appears only on the marker line", async () => {
      const result = await runReview(
        reviewerSaid(
          [
            "I have real concerns about the error handling.",
            "QUIRKS-VERDICT: accept",
            "QUIRKS-EVIDENCE: Everything here is correct and complete.",
          ].join("\n"),
        ),
      );
      // The declaration line cannot be its own proof, so verification fails it
      // closed and no evidence is recorded under a "quote-verified" caption.
      expect(result.record?.verdict).toBe("indeterminate");
      expect(result.record?.outcome).not.toBe("accepted");
      expect(result.record?.evidenceQuote).toBeUndefined();
      expect(result.status).not.toBe("completed");
    });
  });

  it("a reviewer on the implementer's own model is refused before anything dispatches", async () => {
    const root = tempRoot("quirks-parent-");
    const error = await runOpError(
      root,
      Effect.gen(function* () {
        const t = yield* proposeTask(propose({ title: "same-model" }));
        const started = yield* startRun({ name: "same", taskIds: [t.id], yes: true });
        if (started.dryRun) throw new Error("unreachable");
        return yield* executeRun(
          started.run.id,
          fakeHooks({
            implementer: { runner: "claude", model: "sonnet" },
            reviewer: { runner: "cursor", model: "sonnet" },
            review: true,
            dispatch: () => {
              throw new Error("a refused review must never dispatch");
            },
          }),
        );
      }),
    );
    expect(error.message).toMatch(/must differ from the implementer/);
  });
});
