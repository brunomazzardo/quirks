// QK-HARN-001 — the assembled `quirks harness` answer and plan routing.
// The property under test: "can a run lean on this?" has three answers, because
// two would lie. An installed-but-never-dispatched harness is not a yes.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  availability,
  decideLean,
  harnessView,
  routableFrom,
  routeTask,
} from "../src/ops/harness.ts";
import type { RunnerProbe } from "../src/harness/probe.ts";
import type { RunnerLiveness } from "../src/harness/liveness.ts";
import { saveRuns, type Store } from "../src/store/store.ts";
import type { Task } from "../src/store/types.ts";

function store(): Store {
  const root = mkdtempSync(join(tmpdir(), "quirks-harness-"));
  return { root, dir: join(root, ".quirks") };
}

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
  return {
    runner: "claude",
    state: "never-dispatched",
    last: null,
    observed: 0,
    ...partial,
  };
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

describe("decideLean", () => {
  test("absent is a flat no, quoting where we looked", () => {
    const decision = decideLean(
      probe({ presence: { state: "absent", reason: "claude is not on PATH" } }),
      liveness(),
    );
    expect(decision.lean).toBe("no");
    expect(decision.detail).toContain("not on PATH");
  });

  test("denied is a no that refuses to be called absence", () => {
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

  test("installed but never dispatched is unproven, never yes", () => {
    const decision = decideLean(probe(), liveness({ state: "never-dispatched" }));
    // This is the whole three-state argument: we have no evidence either way.
    expect(decision.lean).toBe("unproven");
    expect(decision.detail).toContain("no run has dispatched");
  });

  test("a past success is a yes", () => {
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

  test("a recorded failure is a no carrying the runner's reason", () => {
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

  test("a timed-out dispatch is unproven, not a no", () => {
    const decision = decideLean(probe(), liveness({ state: "timed-out", observed: 1, last: {
      runner: "claude", role: "implementer", model: "sonnet",
      dispatchedAt: new Date().toISOString(), status: "timeout",
      exitCode: null, durationMs: 10, runId: "run-001", taskId: "QK-1",
    } }));
    expect(decision.lean).toBe("unproven");
  });

  test("a version probe that errored overrides a remembered success", () => {
    // The binary is there and once worked, but right now it will not answer.
    const decision = decideLean(
      probe({ version: { state: "error", reason: "exited 1: not logged in", exitCode: 1 } }),
      liveness({ state: "answered", observed: 1, last: {
        runner: "claude", role: "implementer", model: "sonnet",
        dispatchedAt: new Date().toISOString(), status: "success",
        exitCode: 0, durationMs: 10, runId: "run-001", taskId: "QK-1",
      } }),
    );
    expect(decision.lean).toBe("no");
    expect(decision.detail).toContain("not logged in");
  });
});

describe("harnessView", () => {
  test("answers without probing, and says liveness came from the record", async () => {
    const view = await harnessView(store());
    expect(view.probed).toBe(false);
    expect(view.harnesses.map((h) => h.runner)).toEqual(["claude", "codex", "cursor"]);
    for (const row of view.harnesses) {
      expect(row.version).toBeNull();
      expect(row.versionDetail).toContain("--probe");
      // Empty ledger — nothing has been dispatched, and it must not claim otherwise.
      expect(row.liveness).toBe("never-dispatched");
      expect(row.lean).not.toBe("yes");
    }
  });

  test("--probe runs --version and records it", async () => {
    const view = await harnessView(store(), {
      probe: true,
      executables: { claude: script('echo "claude 2.1.217 (Claude Code)"') },
    });
    expect(view.probed).toBe(true);
    const claude = view.harnesses.find((h) => h.runner === "claude")!;
    expect(claude.version).toContain("2.1.217");
    // Present and answering a version, but no run has used it yet.
    expect(claude.lean).toBe("unproven");
  });

  test("carries both D7 views: availability and the full tier table", async () => {
    const view = await harnessView(store());
    expect(view.tiers.map((t) => t.tier)).toEqual([
      "mechanical",
      "standard",
      "high",
      "principal",
    ]);
    expect(view.tiers[1]!.runners.claude).toEqual({ model: "sonnet", effort: "medium" });
    expect(view.tiers[0]!.runners.codex.model).toBeNull();
  });

  test("review rows report independence per tier, and admit when there is none", async () => {
    const view = await harnessView(store(), { executables: { codex: "/nonexistent", cursor: "/nonexistent" } });
    // Only claude can be available, so principal review cannot be independent.
    const principal = view.review.find((r) => r.tier === "principal")!;
    expect(principal.selection.kind).toBe("independence-unavailable");
    const standard = view.review.find((r) => r.tier === "standard")!;
    expect(standard.requiredTier).toBe("high");
  });

  test("available never includes a harness we said no to", async () => {
    const view = await harnessView(store(), {
      executables: {
        claude: "/definitely/not/here",
        codex: "/definitely/not/here",
        cursor: "/definitely/not/here",
      },
    });
    expect(view.available).toEqual([]);
    for (const row of view.harnesses) expect(row.lean).toBe("no");
  });

  test("generatedAt is the injected clock, so the view is reproducible", async () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    const view = await harnessView(store(), { now });
    expect(view.generatedAt).toBe("2026-07-28T12:00:00.000Z");
  });
});

describe("availability (sync) and the routable/lean split", () => {
  /** Record a dispatch outcome for one runner, the way a real run would. */
  function withDispatch(s: Store, runner: "claude" | "codex" | "cursor", status: string): void {
    const now = new Date().toISOString();
    saveRuns(s, [
      {
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
      },
    ]);
  }

  test("is synchronous — no await, no process spawned", () => {
    const result = availability(store());
    expect(result.rows).toHaveLength(3);
    // Nothing was executed, so no row carries a version.
    for (const row of result.rows) expect(row.version).toBeNull();
  });

  test("THE policy: a recorded failure annotates but does NOT remove a harness", () => {
    const s = store();
    const present = script('echo "v1"');
    withDispatch(s, "codex", "failure");

    const { rows, routable } = availability(s, { executables: { codex: present } });
    const codex = rows.find((r) => r.runner === "codex")!;

    // The operator is told not to lean on it...
    expect(codex.lean).toBe("no");
    expect(codex.leanDetail).toContain("usage limit reached");
    // ...but routing still allows it, because we cannot attribute the failure:
    // our own argv bugs exit non-zero exactly like a vendor refusal.
    expect(codex.routable).toBe(true);
    expect(routable).toContain("codex");
  });

  test("absence DOES remove a harness — that is a fact about right now", () => {
    const { rows, routable } = availability(store(), {
      executables: { codex: "/definitely/not/here" },
    });
    const codex = rows.find((r) => r.runner === "codex")!;
    expect(codex.presence).toBe("absent");
    expect(codex.routable).toBe(false);
    expect(routable).not.toContain("codex");
  });

  test("routable order is fixed, so approving the same plan twice yields the same plan", () => {
    const s = script('echo "v1"');
    const withSuccess = store();
    withDispatch(withSuccess, "codex", "success");

    // codex has proven itself and claude has not, but order does not flip:
    // routing must be deterministic across invocations.
    const result = availability(withSuccess, { executables: { claude: s, codex: s, cursor: s } });
    expect(result.routable).toEqual(["claude", "codex", "cursor"]);
    // `available` (the lean answer) is allowed to rank proven-first — it is advice.
    expect(routableFrom(result.rows)).toEqual(["claude", "codex", "cursor"]);
  });

  test("the review table resolves over routable, matching what a run would do", async () => {
    const s = store();
    const present = script('echo "v1"');
    // codex last failed. It stays routable, so a high-tier run WOULD still get it
    // as an independent reviewer — and the table must say so, not a stricter lie.
    withDispatch(s, "codex", "failure");
    const view = await harnessView(s, { executables: { claude: present, codex: present } });

    expect(view.routable).toContain("codex");
    expect(view.available).not.toContain("codex");
    const high = view.review.find((r) => r.tier === "high")!;
    expect(high.selection.kind).toBe("independent");
    if (high.selection.kind !== "independent") throw new Error("unreachable");
    expect(high.selection.reviewer.runner).toBe("codex");
  });
});

describe("routeTask", () => {
  test("no stated effort routes at standard", () => {
    expect(routeTask(task(), ["claude"])).toEqual({
      harness: "claude",
      model: "sonnet",
      tier: "standard",
    });
  });

  test("a stated tier picks that tier's model", () => {
    expect(routeTask(task({ effort: "principal" }), ["claude"]).model).toBe("opus");
    expect(routeTask(task({ effort: "mechanical" }), ["claude"]).model).toBe("haiku");
  });

  test("skips a harness with no model at the tier", () => {
    // cursor has no mechanical model, so routing falls through to claude.
    const routing = routeTask(task({ effort: "mechanical" }), ["cursor", "claude"]);
    expect(routing.harness).toBe("claude");
    expect(routing.model).toBe("haiku");
  });

  test("unassigned when nothing can serve the tier — never an invented route", () => {
    const routing = routeTask(task({ effort: "mechanical" }), ["cursor", "codex"]);
    expect(routing).toEqual({ harness: "unassigned", model: "unassigned", tier: "mechanical" });
  });

  test("no available harness at all is unassigned", () => {
    expect(routeTask(task(), []).harness).toBe("unassigned");
  });
});

describe("authorization may only demote (QK-HARN-003)", () => {
  test("a logged-out harness is a flat no, quoting the runner", () => {
    const decision = decideLean(
      probe({ auth: { state: "unauthorized", detail: "claude reports not logged in" } }),
      liveness(),
    );
    expect(decision.lean).toBe("no");
    expect(decision.detail).toContain("not logged in");
  });

  test("authorized does NOT promote to yes — only a dispatch does", () => {
    const decision = decideLean(
      probe({ auth: { state: "authorized", detail: "credentials present" } }),
      liveness({ state: "never-dispatched" }),
    );
    expect(decision.lean).toBe("unproven");
    // The detail improves, so the operator can see auth checked out.
    expect(decision.detail).toContain("authenticated");
  });

  test("an unknown auth answer changes nothing", () => {
    const decision = decideLean(
      probe({ auth: { state: "unknown", detail: "claude status did not return JSON" } }),
      liveness({ state: "never-dispatched" }),
    );
    expect(decision.lean).toBe("unproven");
    expect(decision.detail).toContain("installed");
  });

  test("unauthorized removes the harness from routing, unlike a past failure", async () => {
    // Being logged out is a present-tense fact, so it blocks routing the way
    // absence does. Only the probed path can know it — see the next test.
    const loggedOut = script('echo \'{"loggedIn":false}\'');
    const view = await harnessView(store(), {
      probe: true,
      executables: { claude: loggedOut },
    });
    const claude = view.harnesses.find((h) => h.runner === "claude")!;
    expect(claude.authorized).toBe("unauthorized");
    expect(claude.lean).toBe("no");
    expect(claude.routable).toBe(false);
    expect(view.routable).not.toContain("claude");
  });

  test("the SYNC path cannot see auth, so plan routing does not consult it", () => {
    // availability() spawns nothing — plan assembly must stay synchronous, and an
    // auth check costs a process (codex doctor also probes the network). So a plan
    // can still route to a logged-out harness; `quirks harness --probe` is where
    // that surfaces. Stating it rather than implying the check is universal.
    const loggedOut = script('echo \'{"loggedIn":false}\'');
    const { rows, routable } = availability(store(), { executables: { claude: loggedOut } });
    expect(rows.find((r) => r.runner === "claude")!.authorized).toBe("not-probed");
    expect(routable).toContain("claude");
  });
});
