// QK-HARN-001 — the assembled `quirks harness` answer and plan routing.
// The property under test: "can a run lean on this?" has three answers, because
// two would lie. An installed-but-never-dispatched harness is not a yes.
// Ported from the bun-era test/harness-view.test.ts (QK-MONO-005).
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import type { Run, RunnerKind, Task } from "@quirks/contracts";
import { describe, expect, it } from "vite-plus/test";
import { availability, decideLean, harnessView, routableFrom, routeTask } from "./Harness.ts";
import type { RunnerProbe } from "../harness/Probe.ts";
import type { RunnerLiveness } from "../harness/Liveness.ts";
import { Ledger } from "../store/Store.ts";
import { runNoSpawn, runOp, tempRoot } from "../testing/Harness.ts";

function script(body: string, mode = 0o755): string {
  const path = join(mkdtempSync(join(tmpdir(), "quirks-hv-")), "fake-cli");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, mode);
  return path;
}

function probe(partial: Partial<RunnerProbe> = {}): RunnerProbe {
  return {
    runner: "claude",
    candidate: "claude",
    presence: { state: "present", executable: "/usr/local/bin/claude" },
    version: { state: "not-probed", reason: "pass --probe to run it" },
    auth: { state: "not-probed", reason: "pass --probe to run it" },
    ...partial,
  };
}

function liveness(partial: Partial<RunnerLiveness> = {}): RunnerLiveness {
  return { runner: "claude", state: "never-dispatched", last: null, observed: 0, ...partial };
}

function task(partial: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: "QK-1",
    title: "t",
    status: "open",
    dependsOn: [],
    deliverables: [],
    acceptanceCriteria: [],
    verification: [],
    sourceRefs: [],
    needsDesign: false,
    needsBreakdown: false,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    statusDetail: {},
    ...partial,
  };
}

function row<T extends { runner: RunnerKind }>(rows: readonly T[], runner: RunnerKind): T {
  const found = rows.find((r) => r.runner === runner);
  if (!found) throw new Error(`no ${runner} row`);
  return found;
}

/** Record a dispatch outcome for one runner, the way a real run would. */
const withDispatch = (runner: RunnerKind, status: string): Effect.Effect<void, unknown, Ledger> =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const now = new Date().toISOString();
    const run: Run = {
      id: "run-001",
      name: "r",
      slug: "r",
      mode: "park-on-issue",
      status: "completed",
      taskIds: ["QK-1"],
      plan: [],
      tasks: [
        {
          taskId: "QK-1",
          outcome: "accepted",
          landingCommit: null,
          worktree: null,
          dispatches: [
            {
              runner,
              role: "implementer",
              model: "x",
              dispatchedAt: now,
              status,
              exitCode: status === "success" ? 0 : 1,
              durationMs: 5,
              ...(status === "success"
                ? {}
                : { failureCode: "non_zero_exit", failureMessage: "usage limit reached" }),
            },
          ],
        },
      ],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    yield* ledger.saveRuns([run]);
  });

describe("decideLean", () => {
  it("absent is a flat no, quoting where we looked", () => {
    const decision = decideLean(
      probe({ presence: { state: "absent", reason: "claude is not on PATH" } }),
      liveness(),
    );
    expect(decision.lean).toBe("no");
    expect(decision.detail).toContain("not on PATH");
  });

  it("denied is a no that refuses to be called absence", () => {
    const decision = decideLean(
      probe({
        presence: {
          state: "denied",
          executable: "/usr/local/bin/claude",
          reason: "found but not executable (EACCES)",
        },
      }),
      liveness(),
    );
    expect(decision.lean).toBe("no");
    expect(decision.detail).toContain("not absence");
  });

  it("installed but never dispatched is unproven, never yes", () => {
    const decision = decideLean(probe(), liveness({ state: "never-dispatched" }));
    // This is the whole three-state argument: we have no evidence either way.
    expect(decision.lean).toBe("unproven");
    expect(decision.detail).toContain("no run has dispatched");
  });

  it("a past success is a yes", () => {
    const decision = decideLean(
      probe(),
      liveness({
        state: "answered",
        observed: 1,
        last: {
          runner: "claude",
          role: "implementer",
          model: "sonnet",
          dispatchedAt: new Date().toISOString(),
          status: "success",
          exitCode: 0,
          durationMs: 10,
          runId: "run-001",
          taskId: "QK-1",
        },
      }),
    );
    expect(decision.lean).toBe("yes");
    expect(decision.detail).toContain("answered");
  });

  it("a recorded failure is a no carrying the runner's reason", () => {
    const decision = decideLean(
      probe({ runner: "codex", candidate: "codex" }),
      liveness({
        runner: "codex",
        state: "failed",
        observed: 1,
        last: {
          runner: "codex",
          role: "implementer",
          model: "gpt-5.5",
          dispatchedAt: new Date().toISOString(),
          status: "failure",
          exitCode: 1,
          durationMs: 10,
          failureCode: "non_zero_exit",
          failureMessage: "usage limit reached",
          runId: "run-001",
          taskId: "QK-1",
        },
      }),
    );
    expect(decision.lean).toBe("no");
    expect(decision.detail).toContain("usage limit reached");
  });

  it("a timed-out dispatch is unproven, not a no", () => {
    const decision = decideLean(
      probe(),
      liveness({
        state: "timed-out",
        observed: 1,
        last: {
          runner: "claude",
          role: "implementer",
          model: "sonnet",
          dispatchedAt: new Date().toISOString(),
          status: "timeout",
          exitCode: null,
          durationMs: 10,
          runId: "run-001",
          taskId: "QK-1",
        },
      }),
    );
    expect(decision.lean).toBe("unproven");
  });

  it("a version probe that errored overrides a remembered success", () => {
    // The binary is there and once worked, but right now it will not answer.
    const decision = decideLean(
      probe({ version: { state: "error", reason: "exited 1: not logged in", exitCode: 1 } }),
      liveness({
        state: "answered",
        observed: 1,
        last: {
          runner: "claude",
          role: "implementer",
          model: "sonnet",
          dispatchedAt: new Date().toISOString(),
          status: "success",
          exitCode: 0,
          durationMs: 10,
          runId: "run-001",
          taskId: "QK-1",
        },
      }),
    );
    expect(decision.lean).toBe("no");
    expect(decision.detail).toContain("not logged in");
  });
});

describe("harnessView", () => {
  it("answers without probing, and says liveness came from the record", async () => {
    const view = await runOp(tempRoot("quirks-harness-"), harnessView());
    expect(view.probed).toBe(false);
    expect(view.harnesses.map((h) => h.runner)).toEqual(["claude", "codex", "cursor"]);
    for (const r of view.harnesses) {
      expect(r.version).toBeNull();
      expect(r.versionDetail).toContain("--probe");
      // Empty ledger — nothing has been dispatched, and it must not claim otherwise.
      expect(r.liveness).toBe("never-dispatched");
      expect(r.lean).not.toBe("yes");
    }
  });

  it("--probe runs --version and records it", async () => {
    const view = await runOp(
      tempRoot("quirks-harness-"),
      harnessView({
        probe: true,
        executables: { claude: script('echo "claude 2.1.217 (Claude Code)"') },
      }),
    );
    expect(view.probed).toBe(true);
    const claude = row(view.harnesses, "claude");
    expect(claude.version).toContain("2.1.217");
    // Present and answering a version, but no run has used it yet.
    expect(claude.lean).toBe("unproven");
  });

  it("carries both D7 views: availability and the full tier table", async () => {
    const view = await runOp(tempRoot("quirks-harness-"), harnessView());
    expect(view.tiers.map((t) => t.tier)).toEqual(["mechanical", "standard", "high", "principal"]);
    expect(view.tiers[1]?.runners.claude).toEqual({ model: "sonnet", effort: "medium" });
    expect(view.tiers[0]?.runners.codex.model).toBeNull();
  });

  it("review rows report independence per tier, and admit when there is none", async () => {
    const view = await runOp(
      tempRoot("quirks-harness-"),
      harnessView({ executables: { codex: "/nonexistent", cursor: "/nonexistent" } }),
    );
    // Only claude can be available, so principal review cannot be independent.
    expect(view.review.find((r) => r.tier === "principal")?.selection.kind).toBe(
      "independence-unavailable",
    );
    expect(view.review.find((r) => r.tier === "standard")?.requiredTier).toBe("high");
  });

  it("available never includes a harness we said no to", async () => {
    const view = await runOp(
      tempRoot("quirks-harness-"),
      harnessView({
        executables: {
          claude: "/definitely/not/here",
          codex: "/definitely/not/here",
          cursor: "/definitely/not/here",
        },
      }),
    );
    expect(view.available).toEqual([]);
    for (const r of view.harnesses) expect(r.lean).toBe("no");
  });

  it("generatedAt is the injected clock, so the view is reproducible", async () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    const view = await runOp(tempRoot("quirks-harness-"), harnessView({ now }));
    expect(view.generatedAt).toBe("2026-07-28T12:00:00.000Z");
  });
});

describe("availability and the routable/lean split", () => {
  it("spawns nothing — it runs in a layer that has no ChildProcessSpawner at all", async () => {
    // The bun-era suite could only assert `availability()` was declared sync.
    // Here the layer physically cannot start a process, so plan assembly's
    // "consults presence, executes nothing" (QK-HARN-002) is checked, not stated.
    const result = await runNoSpawn(tempRoot("quirks-harness-"), availability());
    expect(result.rows).toHaveLength(3);
    for (const r of result.rows) expect(r.version).toBeNull();
  });

  it("THE policy: a recorded failure annotates but does NOT remove a harness", async () => {
    const present = script('echo "v1"');
    const result = await runOp(
      tempRoot("quirks-harness-"),
      Effect.gen(function* () {
        yield* withDispatch("codex", "failure");
        return yield* availability({ executables: { codex: present } });
      }),
    );
    const codex = row(result.rows, "codex");

    // The operator is told not to lean on it...
    expect(codex.lean).toBe("no");
    expect(codex.leanDetail).toContain("usage limit reached");
    // ...but routing still allows it, because we cannot attribute the failure:
    // our own argv bugs exit non-zero exactly like a vendor refusal.
    expect(codex.routable).toBe(true);
    expect(result.routable).toContain("codex");
  });

  it("absence DOES remove a harness — that is a fact about right now", async () => {
    const result = await runOp(
      tempRoot("quirks-harness-"),
      availability({ executables: { codex: "/definitely/not/here" } }),
    );
    const codex = row(result.rows, "codex");
    expect(codex.presence).toBe("absent");
    expect(codex.routable).toBe(false);
    expect(result.routable).not.toContain("codex");
  });

  it("routable order is fixed, so approving the same plan twice yields the same plan", async () => {
    const s = script('echo "v1"');
    const result = await runOp(
      tempRoot("quirks-harness-"),
      Effect.gen(function* () {
        // codex has proven itself and claude has not, but order does not flip:
        // routing must be deterministic across invocations.
        yield* withDispatch("codex", "success");
        return yield* availability({ executables: { claude: s, codex: s, cursor: s } });
      }),
    );
    expect(result.routable).toEqual(["claude", "codex", "cursor"]);
    // `available` (the lean answer) is allowed to rank proven-first — it is advice.
    expect(routableFrom(result.rows)).toEqual(["claude", "codex", "cursor"]);
  });

  it("the review table resolves over routable, matching what a run would do", async () => {
    const present = script('echo "v1"');
    const view = await runOp(
      tempRoot("quirks-harness-"),
      Effect.gen(function* () {
        // codex last failed. It stays routable, so a high-tier run WOULD still get
        // it as an independent reviewer — the table must say so, not a stricter lie.
        yield* withDispatch("codex", "failure");
        return yield* harnessView({ executables: { claude: present, codex: present } });
      }),
    );

    expect(view.routable).toContain("codex");
    expect(view.available).not.toContain("codex");
    const high = view.review.find((r) => r.tier === "high");
    expect(high?.selection.kind).toBe("independent");
    if (high?.selection.kind !== "independent") throw new Error("unreachable");
    expect(high.selection.reviewer.runner).toBe("codex");
  });
});

describe("routeTask", () => {
  it("no stated effort routes at standard", () => {
    expect(routeTask(task(), ["claude"])).toEqual({
      harness: "claude",
      model: "sonnet",
      tier: "standard",
    });
  });

  it("a stated tier picks that tier's model", () => {
    expect(routeTask(task({ effort: "principal" }), ["claude"]).model).toBe("opus");
    expect(routeTask(task({ effort: "mechanical" }), ["claude"]).model).toBe("haiku");
  });

  it("skips a harness with no model at the tier", () => {
    // cursor has no mechanical model, so routing falls through to claude.
    const routing = routeTask(task({ effort: "mechanical" }), ["cursor", "claude"]);
    expect(routing.harness).toBe("claude");
    expect(routing.model).toBe("haiku");
  });

  it("unassigned when nothing can serve the tier — never an invented route", () => {
    expect(routeTask(task({ effort: "mechanical" }), ["cursor", "codex"])).toEqual({
      harness: "unassigned",
      model: "unassigned",
      tier: "mechanical",
    });
  });

  it("no available harness at all is unassigned", () => {
    expect(routeTask(task(), []).harness).toBe("unassigned");
  });
});

describe("authorization may only demote (QK-HARN-003)", () => {
  it("a logged-out harness is a flat no, quoting the runner", () => {
    const decision = decideLean(
      probe({ auth: { state: "unauthorized", detail: "claude reports not logged in" } }),
      liveness(),
    );
    expect(decision.lean).toBe("no");
    expect(decision.detail).toContain("not logged in");
  });

  it("authorized does NOT promote to yes — only a dispatch does", () => {
    const decision = decideLean(
      probe({ auth: { state: "authorized", detail: "credentials present" } }),
      liveness({ state: "never-dispatched" }),
    );
    expect(decision.lean).toBe("unproven");
    // The detail improves, so the operator can see auth checked out.
    expect(decision.detail).toContain("authenticated");
  });

  it("an unknown auth answer changes nothing", () => {
    const decision = decideLean(
      probe({ auth: { state: "unknown", detail: "claude status did not return JSON" } }),
      liveness({ state: "never-dispatched" }),
    );
    expect(decision.lean).toBe("unproven");
    expect(decision.detail).toContain("installed");
  });

  it("unauthorized removes the harness from routing, unlike a past failure", async () => {
    // Being logged out is a present-tense fact, so it blocks routing the way
    // absence does. Only the probed path can know it — see the next test.
    const loggedOut = script("echo '{\"loggedIn\":false}'");
    const view = await runOp(
      tempRoot("quirks-harness-"),
      harnessView({ probe: true, executables: { claude: loggedOut } }),
    );
    const claude = row(view.harnesses, "claude");
    expect(claude.authorized).toBe("unauthorized");
    expect(claude.lean).toBe("no");
    expect(claude.routable).toBe(false);
    expect(view.routable).not.toContain("claude");
  });

  it("the free path cannot see auth, so plan routing does not consult it", async () => {
    // availability() spawns nothing — plan assembly must stay free of processes,
    // and an auth check costs one (codex doctor also probes the network). So a
    // plan can still route to a logged-out harness; `quirks harness --probe` is
    // where that surfaces. Stating it rather than implying the check is universal.
    const loggedOut = script("echo '{\"loggedIn\":false}'");
    const result = await runNoSpawn(
      tempRoot("quirks-harness-"),
      availability({ executables: { claude: loggedOut } }),
    );
    expect(row(result.rows, "claude").authorized).toBe("not-probed");
    expect(result.routable).toContain("claude");
  });
});
