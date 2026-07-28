// QK-HARN-001 — liveness derived from the run record, not a live round trip.
// The property that matters: absence stays absence. A runner nobody dispatched is
// never "answered", and a failure keeps the runner's own words so a quota refusal
// arrives with a real date instead of prose in a checked-in doc.
// Ported from the bun-era test/harness-liveness.test.ts (QK-MONO-005).
import type { Run, RunDispatchRecord } from "@quirks/contracts";
import { describe, expect, it } from "vite-plus/test";
import { allDispatches, describeAge, describeLiveness, deriveLiveness } from "./Liveness.ts";

/** The suite refuses `!`: an absent row is a real failure, not a cast away. */
function nonNull<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a row, got none");
  return value;
}

function dispatch(partial: Partial<RunDispatchRecord> = {}): RunDispatchRecord {
  return {
    runner: "claude",
    role: "implementer",
    model: "sonnet",
    dispatchedAt: "2026-07-28T10:00:00.000Z",
    status: "success",
    exitCode: 0,
    durationMs: 1000,
    ...partial,
  };
}

function run(id: string, dispatches: RunDispatchRecord[]): Run {
  const now = "2026-07-28T09:00:00.000Z";
  return {
    id,
    name: id,
    slug: id,
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
        dispatches,
      },
    ],
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

describe("deriveLiveness", () => {
  it("no runs at all means never-dispatched for everyone", () => {
    const liveness = deriveLiveness([]);
    expect(liveness.map((l) => l.runner)).toEqual(["claude", "codex", "cursor"]);
    for (const entry of liveness) {
      expect(entry.state).toBe("never-dispatched");
      expect(entry.last).toBeNull();
      expect(entry.observed).toBe(0);
    }
  });

  it("a runner with no dispatch stays never-dispatched while a sibling answers", () => {
    const liveness = deriveLiveness([run("run-001", [dispatch({ runner: "claude" })])]);
    const byRunner = new Map(liveness.map((l) => [l.runner, l]));
    expect(byRunner.get("claude")?.state).toBe("answered");
    // Crucially: claude answering says nothing about codex.
    expect(byRunner.get("codex")?.state).toBe("never-dispatched");
    expect(byRunner.get("cursor")?.state).toBe("never-dispatched");
  });

  it("the newest dispatch decides, across runs", () => {
    const liveness = deriveLiveness([
      run("run-001", [
        dispatch({ runner: "codex", dispatchedAt: "2026-07-27T10:00:00.000Z", status: "success" }),
      ]),
      run("run-002", [
        dispatch({
          runner: "codex",
          dispatchedAt: "2026-07-28T10:00:00.000Z",
          status: "failure",
          exitCode: 1,
          failureCode: "non_zero_exit",
          failureMessage: "runner exited 1: usage limit reached, resets Jul 28 2:02 PM",
        }),
      ]),
    ]);
    const codex = nonNull(liveness.find((l) => l.runner === "codex"));
    expect(codex.state).toBe("failed");
    expect(codex.observed).toBe(2);
    expect(codex.last?.runId).toBe("run-002");
    // The quota fact the founding doc wanted out of prose — now dated and owned.
    expect(codex.last?.failureMessage).toContain("usage limit");
  });

  it("an older success does not override a newer failure", () => {
    const liveness = deriveLiveness([
      run("run-001", [
        dispatch({ dispatchedAt: "2026-07-28T12:00:00.000Z", status: "failure", exitCode: 1 }),
        dispatch({ dispatchedAt: "2026-07-28T08:00:00.000Z", status: "success" }),
      ]),
    ]);
    expect(nonNull(liveness.find((l) => l.runner === "claude")).state).toBe("failed");
  });

  it("a timeout is its own state — silent, not broken", () => {
    const liveness = deriveLiveness([
      run("run-001", [dispatch({ status: "timeout", exitCode: null })]),
    ]);
    expect(nonNull(liveness.find((l) => l.runner === "claude")).state).toBe("timed-out");
  });

  it("runs with no tasks or no dispatches are tolerated", () => {
    // A run approved but never executed has no `tasks` key at all.
    const { tasks: _omitted, ...bare } = run("run-001", []);
    expect(() => deriveLiveness([bare as Run, run("run-002", [])])).not.toThrow();
    expect(deriveLiveness([bare as Run])[0]?.state).toBe("never-dispatched");
  });
});

describe("allDispatches", () => {
  it("flattens every run and task, oldest first", () => {
    const flat = allDispatches([
      run("run-002", [dispatch({ dispatchedAt: "2026-07-28T10:00:00.000Z" })]),
      run("run-001", [dispatch({ dispatchedAt: "2026-07-27T10:00:00.000Z" })]),
    ]);
    expect(flat.map((d) => d.runId)).toEqual(["run-001", "run-002"]);
    expect(flat[0]?.taskId).toBe("QK-1");
  });
});

describe("describeAge / describeLiveness", () => {
  const now = new Date("2026-07-28T12:00:00.000Z");

  it("ages read in the largest sensible unit", () => {
    expect(describeAge("2026-07-28T11:59:30.000Z", now)).toBe("30s ago");
    expect(describeAge("2026-07-28T11:46:00.000Z", now)).toBe("14m ago");
    expect(describeAge("2026-07-28T02:00:00.000Z", now)).toBe("10h ago");
    expect(describeAge("2026-07-20T12:00:00.000Z", now)).toBe("8d ago");
  });

  it("an unparseable timestamp says so rather than computing nonsense", () => {
    expect(describeAge("not a date", now)).toBe("at an unparseable time");
  });

  it("a failure line carries the runner's own first line", () => {
    const liveness = deriveLiveness([
      run("run-001", [
        dispatch({
          dispatchedAt: "2026-07-28T11:00:00.000Z",
          status: "failure",
          failureMessage: "runner exited 1: usage limit reached\nsecond line dropped",
        }),
      ]),
    ]);
    const line = describeLiveness(nonNull(liveness.find((l) => l.runner === "claude")), now);
    expect(line).toContain("failed 60m ago");
    expect(line).toContain("usage limit reached");
    expect(line).not.toContain("second line");
  });

  it("never-dispatched reads as never dispatched, not as a failure", () => {
    const liveness = deriveLiveness([]);
    expect(describeLiveness(nonNull(liveness[0]), now)).toBe("never dispatched");
  });
});
