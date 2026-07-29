// What a read verb prints on a terminal, asserted as text.
//
// These are the only assertions in the suite that can see a table at all — a
// spawned CLI child never has a TTY (Output.test.ts explains why). Each
// renderer takes the wire response the route actually emits, so a route that
// renames a field breaks a rendering test rather than a user's screen.

import { describe, expect, it } from "vite-plus/test";
import type { Goal, GoalRollup, Run, RunPlan, Task } from "@quirks/contracts";
import { renderGoal, renderRollup } from "./Goal.ts";
import { renderTasks } from "./Task.ts";
import { renderPlan, renderRuns } from "./Run.ts";
import { renderHarnessView, type HarnessView } from "./Harness.ts";
import { renderStatus, verdict, type Status } from "./Daemon.ts";

const rollup = (over: Partial<GoalRollup> = {}): GoalRollup => ({
  id: "QK-SRV",
  title: "the service",
  recorded: true,
  state: "in progress",
  total: 4,
  done: 1,
  open: 2,
  blocked: 1,
  future: 0,
  ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: "QK-SRV-001",
  title: "bind the socket",
  status: "open",
  dependsOn: [],
  deliverables: [],
  acceptanceCriteria: [],
  verification: [],
  sourceRefs: [],
  needsDesign: false,
  needsBreakdown: false,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  statusDetail: {},
  ...over,
});

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: "QK-SRV",
  title: "the service",
  why: { text: "one place that owns the ledger" },
  doneWhen: ["the CLI talks HTTP only"],
  state: "active",
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("goal list", () => {
  it("is one row per goal, columns aligned to their widest cell", () => {
    expect(renderRollup([rollup(), rollup({ id: "QK-RUN", state: "not started" })], 0)).toBe(
      [
        "goal    total  done  open  blocked  future  state",
        "QK-SRV  4      1     2     1        0       in progress",
        "QK-RUN  4      1     2     1        0       not started",
      ].join("\n"),
    );
  });

  it("says how many rows it hid rather than quietly hiding them", () => {
    const out = renderRollup([rollup()], 3);
    expect(out.endsWith("\n… 3 done/abandoned goals omitted (--all)")).toBe(true);
  });

  it("hides nothing when nothing is hidden", () => {
    expect(renderRollup([rollup()], 0)).not.toContain("omitted");
  });
});

describe("goal show", () => {
  it("leads with the goal line, then why, doneWhen, and the member tasks", () => {
    expect(renderGoal(goal(), [task(), task({ id: "QK-SRV-002", status: "completed" })])).toBe(
      [
        "QK-SRV — the service   [active]",
        "why: one place that owns the ledger",
        "done when: the CLI talks HTTP only",
        "",
        "task        status     title",
        "QK-SRV-001  open       bind the socket",
        "QK-SRV-002  completed  bind the socket",
      ].join("\n"),
    );
  });

  it("carries the reason a goal left active into the header", () => {
    expect(renderGoal(goal({ state: "done", stateReason: "criteria met" }), [])).toContain(
      "[done: criteria met]",
    );
  });

  it("prints a pinned why-ref at its short commit, and 'unpinned' when there is none", () => {
    expect(
      renderGoal(goal({ why: { ref: { path: "docs/spec.md", pinnedCommit: "abcdef1234" } } }), []),
    ).toContain("why: docs/spec.md @ abcdef1");
    expect(
      renderGoal(goal({ why: { ref: { path: "docs/spec.md", pinnedCommit: null } } }), []),
    ).toContain("why: docs/spec.md @ unpinned");
  });

  it("says 'no tasks yet' rather than printing an empty table", () => {
    expect(renderGoal(goal(), [])).toContain("no tasks yet");
  });
});

describe("task list", () => {
  it("marks the flags that change what a task means", () => {
    expect(
      renderTasks([
        task({ needsDesign: true }),
        task({ id: "QK-SRV-002", needsBreakdown: true, future: true, status: "blocked" }),
        task({ id: "QK-SRV-003" }),
      ]),
    ).toBe(
      [
        "task        status   flags              title",
        "QK-SRV-001  open     design?            bind the socket",
        "QK-SRV-002  blocked  breakdown? future  bind the socket",
        "QK-SRV-003  open                        bind the socket",
      ].join("\n"),
    );
  });

  it("an empty backlog says so", () => {
    expect(renderTasks([])).toBe("no tasks");
  });
});

describe("the run plan — the whole approval surface", () => {
  const plan: RunPlan = {
    name: "tonight",
    slug: "tonight",
    goal: "QK-SRV",
    mode: "park-on-issue",
    taskIds: ["QK-SRV-001"],
    plan: [
      {
        id: "QK-SRV-001",
        title: "bind the socket",
        order: 1,
        harness: "claude",
        model: "sonnet",
        estimatedCost: null,
      },
    ],
    warnings: ["harness claude: no run has dispatched to it yet"],
  };

  it("prints header, then the per-task table, then the caveats last", () => {
    expect(renderPlan(plan)).toBe(
      [
        "run: tonight (tonight)",
        "mode: park-on-issue",
        "goal: QK-SRV",
        "1 task(s)",
        "",
        "#  task        harness  model   est.  title",
        "1  QK-SRV-001  claude   sonnet  ?     bind the socket",
        "",
        "before you approve:",
        "  ! harness claude: no run has dispatched to it yet",
      ].join("\n"),
    );
  });

  it("an unknown cost is '?' — never an invented number", () => {
    expect(renderPlan(plan)).toContain("?     bind the socket");
    expect(renderPlan({ ...plan, plan: [{ ...plan.plan[0]!, estimatedCost: 12 }] })).toContain(
      "12    bind the socket",
    );
  });

  it("drops the goal line and the caveats block when there are none", () => {
    const { goal: _goal, ...goalless } = plan;
    const bare = renderPlan({ ...goalless, warnings: [] });
    expect(bare).not.toContain("goal:");
    expect(bare).not.toContain("before you approve");
  });
});

describe("run list", () => {
  const run: Run = {
    id: "run-001",
    name: "tonight",
    slug: "tonight",
    mode: "autonomous",
    status: "approved",
    taskIds: ["QK-SRV-001", "QK-SRV-002"],
    plan: [],
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("counts tasks rather than listing them", () => {
    expect(renderRuns([run])).toBe(
      [
        "run      slug     status    mode        tasks  name",
        "run-001  tonight  approved  autonomous  2      tonight",
      ].join("\n"),
    );
  });

  it("an empty repo says so", () => {
    expect(renderRuns([])).toBe("no runs");
  });
});

describe("harness", () => {
  const view: HarnessView = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    probed: false,
    harnesses: [
      {
        runner: "claude",
        executable: "claude",
        presence: "present",
        presenceDetail: "claude",
        version: null,
        versionDetail: "not probed",
        liveness: "never-dispatched",
        livenessDetail: "never dispatched",
        authorized: "not-probed",
        authDetail: "not probed",
        lean: "unproven",
        leanDetail: "installed, but no run has dispatched to it yet",
        routable: true,
      },
      {
        runner: "codex",
        executable: "codex",
        presence: "absent",
        presenceDetail: "not on PATH",
        version: null,
        versionDetail: "not probed",
        liveness: "never-dispatched",
        livenessDetail: "never dispatched",
        authorized: "not-probed",
        authDetail: "not probed",
        lean: "no",
        leanDetail: "not on PATH",
        routable: false,
      },
    ],
    tiers: [
      {
        tier: "standard",
        runners: {
          claude: { model: "sonnet", effort: null },
          codex: { model: "gpt-5.5", effort: "medium" },
        },
      },
    ],
    review: [
      {
        tier: "standard",
        requiredTier: "standard",
        selection: {
          kind: "independent",
          reviewer: { runner: "codex", model: "gpt-5.5", tier: "standard" },
          reason: "different family",
        },
      },
    ],
    available: [],
    routable: ["claude"],
  };

  it("answers 'lean on it?' first, and says why for every answer that is not yes", () => {
    const out = renderHarnessView(view);
    expect(out).toContain("harness  lean on it?  present  authed      version     last dispatch");
    expect(out).toContain(
      "claude   unproven     yes      not probed  not probed  never dispatched",
    );
    // `no` shouts, and the presence state stands in for "present" when it is not.
    expect(out).toContain("codex    NO           absent");
    expect(out).toContain("  claude: installed, but no run has dispatched to it yet");
    expect(out).toContain("  codex: not on PATH");
  });

  it("says 'none' rather than printing an empty availability line", () => {
    expect(renderHarnessView(view)).toContain("available for a run now: none");
    expect(renderHarnessView({ ...view, available: ["claude"] })).toContain(
      "available for a run now: claude",
    );
  });

  it("renders the tier table with effort where a tier has one, and — where it has no model", () => {
    const out = renderHarnessView(view);
    expect(out).toContain("tier      claude  codex");
    expect(out).toContain("standard  sonnet  gpt-5.5 / medium");
    expect(
      renderHarnessView({
        ...view,
        tiers: [{ tier: "high", runners: { claude: { model: null, effort: null } } }],
      }),
    ).toContain("high  —");
  });

  it("names the independent reviewer, or says review cannot be independent", () => {
    expect(renderHarnessView(view)).toContain("standard          standard       codex/gpt-5.5");
    const none = renderHarnessView({
      ...view,
      review: [
        {
          tier: "standard",
          requiredTier: "high",
          selection: {
            kind: "independence-unavailable",
            requiredTier: "high",
            reason: "only claude is installed",
          },
        },
      ],
    });
    expect(none).toContain("NONE — review cannot be independent");
  });

  it("tells you the header changed when --probe ran", () => {
    expect(renderHarnessView(view)).toContain("pass --probe to run --version");
    expect(renderHarnessView({ ...view, probed: true })).toContain(
      "probed --version against each present harness",
    );
  });
});

describe("daemon status", () => {
  const status = (over: Partial<Status> = {}): Status => ({
    running: true,
    root: "/repo",
    port: 45001,
    health: {
      id: "abc",
      root: "/repo",
      startedAt: "2026-01-01T00:00:00.000Z",
      code: { fingerprint: "aaaa", source: "src", files: 3, dir: "/repo/src" },
      runsInFlight: [],
    },
    tree: "aaaa",
    drifted: false,
    comparable: true,
    runsInFlight: [],
    ...over,
  });

  it("a daemon that is not up says so, and says any command starts one", () => {
    expect(renderStatus(status({ running: false, health: null }))).toBe(
      "not running (port 45001) — any quirks command starts one.",
    );
  });

  it("puts the two fingerprints side by side, then the verdict", () => {
    expect(renderStatus(status())).toBe(
      [
        "field           value",
        "port            45001",
        "started         2026-01-01T00:00:00.000Z",
        "serving code    aaaa",
        "your tree       aaaa",
        "runs in flight  none",
        "",
        "up to date — the daemon is running your current tree.",
      ].join("\n"),
    );
  });

  it("names the runs a restart would kill", () => {
    expect(renderStatus(status({ runsInFlight: ["run-007"] }))).toContain(
      "runs in flight  run-007",
    );
  });

  it("drift is STALE; incomparable is neither up-to-date nor stale", () => {
    expect(verdict(status({ drifted: true, tree: "bbbb" }))).toContain("STALE");
    // Ignorance is never dressed as agreement — that is the lie the check exists
    // to remove.
    const unknown = verdict(status({ comparable: false }));
    expect(unknown).toContain("does not report which code it is running");
    expect(unknown).not.toContain("up to date");
  });
});
