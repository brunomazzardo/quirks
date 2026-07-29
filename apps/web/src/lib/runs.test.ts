import type {
  Run,
  RunDispatchRecord,
  RunPlanEntry,
  RunStatus,
  RunTaskOutcome,
  RunTaskRecord,
} from "@quirks/contracts";
import { expect, it } from "vite-plus/test";

import {
  buildRunReport,
  buildRunRows,
  dispatchSucceeded,
  formatDuration,
  formatStamp,
  lastDispatch,
  needsYouKind,
  nextPollDelay,
  planComparison,
  POLL_CEILING_MS,
  POLL_HIDDEN_MS,
  POLL_VISIBLE_MS,
  runElapsedMs,
  runEntries,
  runIsLive,
  runIsTerminal,
  runProgress,
  runTone,
} from "./runs";

// ---------------------------------------------------------------------------
// fixtures — built field by field rather than by spreading Partial<T>, because
// exactOptionalPropertyTypes makes `{ goal: undefined }` and "no goal" two
// different things, and the record's optionality is load bearing here.
// ---------------------------------------------------------------------------

function planEntry(
  id: string,
  order: number,
  harness = "claude",
  model = "sonnet",
  estimatedCost: number | null = null,
): RunPlanEntry {
  return { id, title: `title ${id}`, order, harness, model, estimatedCost };
}

interface RecordInput {
  readonly verdict?: RunTaskRecord["verdict"];
  readonly reason?: string;
  readonly evidenceQuote?: string;
  readonly implementerModel?: string;
  readonly landingCommit?: string;
  readonly dispatches?: readonly RunDispatchRecord[];
}

function record(taskId: string, outcome: RunTaskOutcome, input: RecordInput = {}): RunTaskRecord {
  return {
    taskId,
    outcome,
    landingCommit: input.landingCommit ?? null,
    worktree: null,
    ...(input.verdict !== undefined ? { verdict: input.verdict } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(input.evidenceQuote !== undefined ? { evidenceQuote: input.evidenceQuote } : {}),
    ...(input.implementerModel !== undefined ? { implementerModel: input.implementerModel } : {}),
    ...(input.dispatches !== undefined ? { dispatches: [...input.dispatches] } : {}),
  };
}

interface DispatchInput {
  readonly runner?: RunDispatchRecord["runner"];
  readonly role?: RunDispatchRecord["role"];
  readonly model?: string;
  readonly dispatchedAt?: string;
  readonly status?: string;
  readonly exitCode?: number | null;
  readonly durationMs?: number;
  readonly failureCode?: string;
  readonly failureMessage?: string;
}

function dispatch(input: DispatchInput = {}): RunDispatchRecord {
  return {
    runner: input.runner ?? "claude",
    role: input.role ?? "implementer",
    model: input.model ?? "sonnet",
    dispatchedAt: input.dispatchedAt ?? "2026-07-28T22:04:00.000Z",
    status: input.status ?? "success",
    exitCode: input.exitCode === undefined ? 0 : input.exitCode,
    durationMs: input.durationMs ?? 1_000,
    ...(input.failureCode !== undefined ? { failureCode: input.failureCode } : {}),
    ...(input.failureMessage !== undefined ? { failureMessage: input.failureMessage } : {}),
  };
}

interface RunInput {
  readonly id?: string;
  readonly name?: string;
  readonly slug?: string;
  readonly goal?: string;
  readonly status?: RunStatus;
  readonly taskIds?: readonly string[];
  readonly plan?: readonly RunPlanEntry[];
  readonly tasks?: readonly RunTaskRecord[];
  readonly createdAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

function run(input: RunInput = {}): Run {
  const plan = input.plan ?? [];
  return {
    id: input.id ?? "run_01",
    name: input.name ?? "a night",
    slug: input.slug ?? "a-night",
    mode: "park-on-issue",
    status: input.status ?? "completed",
    taskIds: [...(input.taskIds ?? plan.map((entry) => entry.id))],
    plan: [...plan],
    revision: 1,
    createdAt: input.createdAt ?? "2026-07-28T22:00:00.000Z",
    updatedAt: "2026-07-28T23:00:00.000Z",
    ...(input.goal !== undefined ? { goal: input.goal } : {}),
    ...(input.tasks !== undefined ? { tasks: [...input.tasks] } : {}),
    ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
    ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

it("terminal means completed or abandoned; live means running or approved", () => {
  expect(runIsTerminal("completed")).toBe(true);
  expect(runIsTerminal("abandoned")).toBe(true);
  expect(runIsTerminal("running")).toBe(false);
  expect(runIsTerminal("approved")).toBe(false);
  expect(runIsTerminal("planned")).toBe(false);

  expect(runIsLive("running")).toBe(true);
  expect(runIsLive("approved")).toBe(true);
  // A dry-run artefact has no execution ahead of it — nothing to watch.
  expect(runIsLive("planned")).toBe(false);
  expect(runIsLive("completed")).toBe(false);
});

// ---------------------------------------------------------------------------
// what needs you (D14)
// ---------------------------------------------------------------------------

it("classifies the record vocabulary into D14's NEEDS YOU kinds", () => {
  expect(needsYouKind(record("t", "failed"))).toBe("rejected");
  // park-on-issue with no landing releases the work; it is the same rejection.
  expect(needsYouKind(record("t", "released"))).toBe("rejected");
  expect(needsYouKind(record("t", "held"))).toBe("held");
  expect(needsYouKind(record("t", "blocked"))).toBe("blocked");
  expect(needsYouKind(record("t", "accepted"))).toBe(null);
  expect(needsYouKind(record("t", "pending"))).toBe(null);
  expect(needsYouKind(record("t", "running"))).toBe(null);
});

it("an unreadable verdict needs you even when the outcome does not say so", () => {
  // "indeterminate is its own outcome, printed under NEEDS YOU" — absence
  // fails closed everywhere else in this product.
  expect(needsYouKind(record("t", "partial", { verdict: "indeterminate" }))).toBe("indeterminate");
  expect(needsYouKind(record("t", "partial", { verdict: "accept" }))).toBe(null);
});

it("a rejected record that also has an unreadable verdict reads as rejected", () => {
  expect(needsYouKind(record("t", "failed", { verdict: "indeterminate" }))).toBe("rejected");
});

// ---------------------------------------------------------------------------
// the join
// ---------------------------------------------------------------------------

it("an approved task with no record is a pending row, never a missing one", () => {
  const subject = run({
    plan: [planEntry("QK-A-001", 1), planEntry("QK-A-002", 2)],
    tasks: [record("QK-A-001", "accepted")],
  });

  const entries = runEntries(subject);
  expect(entries.map((entry) => entry.taskId)).toEqual(["QK-A-001", "QK-A-002"]);
  expect(entries[1]?.record.outcome).toBe("pending");
  expect(entries[1]?.unrecorded).toBe(true);
  expect(entries[0]?.unrecorded).toBe(false);
});

it("a record for a task the plan never listed still appears, at the end", () => {
  const subject = run({
    plan: [planEntry("QK-A-001", 1)],
    taskIds: ["QK-A-001"],
    tasks: [record("QK-A-001", "accepted"), record("QK-A-009", "failed")],
  });

  const entries = runEntries(subject);
  expect(entries.map((entry) => entry.taskId)).toEqual(["QK-A-001", "QK-A-009"]);
  expect(entries[1]?.plan).toBe(null);
  expect(entries[1]?.title).toBe("QK-A-009");
});

// ---------------------------------------------------------------------------
// progress
// ---------------------------------------------------------------------------

it("counts every approved task, and needs-you is the sum of the four kinds", () => {
  const subject = run({
    plan: [
      planEntry("QK-A-001", 1),
      planEntry("QK-A-002", 2),
      planEntry("QK-A-003", 3),
      planEntry("QK-A-004", 4),
      planEntry("QK-A-005", 5),
      planEntry("QK-A-006", 6),
      planEntry("QK-A-007", 7),
    ],
    tasks: [
      record("QK-A-001", "accepted"),
      record("QK-A-002", "failed"),
      record("QK-A-003", "blocked"),
      record("QK-A-004", "held"),
      record("QK-A-005", "partial", { verdict: "indeterminate" }),
      record("QK-A-006", "partial"),
      record("QK-A-007", "running"),
    ],
  });

  const progress = runProgress(subject);
  expect(progress).toEqual({
    total: 7,
    accepted: 1,
    partial: 1,
    rejected: 1,
    held: 1,
    blocked: 1,
    indeterminate: 1,
    running: 1,
    pending: 0,
    needsYou: 4,
  });
});

it("total is the approved plan, so an untouched task shows as queued", () => {
  const subject = run({
    plan: [planEntry("QK-A-001", 1), planEntry("QK-A-002", 2), planEntry("QK-A-003", 3)],
    tasks: [record("QK-A-001", "accepted")],
  });
  const progress = runProgress(subject);
  expect(progress.total).toBe(3);
  expect(progress.accepted).toBe(1);
  expect(progress.pending).toBe(2);
});

// ---------------------------------------------------------------------------
// tone and the list
// ---------------------------------------------------------------------------

it("a damaged run reads ember even while it is still running", () => {
  const moving = run({
    status: "running",
    plan: [planEntry("QK-A-001", 1)],
    tasks: [record("QK-A-001", "running")],
  });
  expect(runTone(moving)).toBe("live");

  const damaged = run({
    status: "running",
    plan: [planEntry("QK-A-001", 1), planEntry("QK-A-002", 2)],
    tasks: [record("QK-A-001", "failed"), record("QK-A-002", "running")],
  });
  expect(runTone(damaged)).toBe("attention");
  // …and it is still live: the two facts are independent.
  expect(runIsLive(damaged.status)).toBe(true);
});

it("a clean finish is moss; planned and abandoned stay muted", () => {
  expect(
    runTone(
      run({
        status: "completed",
        plan: [planEntry("QK-A-001", 1)],
        tasks: [record("QK-A-001", "accepted")],
      }),
    ),
  ).toBe("clean");
  expect(runTone(run({ status: "planned" }))).toBe("quiet");
  expect(runTone(run({ status: "abandoned" }))).toBe("quiet");
});

it("rows are newest first, ties broken by id descending", () => {
  const rows = buildRunRows([
    run({ id: "run_a", createdAt: "2026-07-01T00:00:00.000Z" }),
    run({ id: "run_c", createdAt: "2026-07-03T00:00:00.000Z" }),
    run({ id: "run_b", createdAt: "2026-07-03T00:00:00.000Z" }),
  ]);
  expect(rows.map((row) => row.run.id)).toEqual(["run_c", "run_b", "run_a"]);
});

// ---------------------------------------------------------------------------
// the report — NEEDS YOU first, never chronological
// ---------------------------------------------------------------------------

it("sections come in D14's fixed order and empty ones are omitted", () => {
  const subject = run({
    plan: [planEntry("QK-A-001", 1), planEntry("QK-A-002", 2)],
    tasks: [record("QK-A-001", "accepted"), record("QK-A-002", "failed")],
  });

  const sections = buildRunReport(subject);
  expect(sections.map((section) => section.id)).toEqual(["needs-you", "accepted"]);
  expect(sections[0]?.label).toBe("NEEDS YOU");
});

it("a clean run has no NEEDS YOU section at all", () => {
  const sections = buildRunReport(
    run({ plan: [planEntry("QK-A-001", 1)], tasks: [record("QK-A-001", "accepted")] }),
  );
  expect(sections.map((section) => section.id)).toEqual(["accepted"]);
});

it("orders NEEDS YOU by severity, then by the approved plan order", () => {
  // Deliberately recorded in the reverse of the order they must print in, and
  // with plan order shuffled inside the rejected pair.
  const subject = run({
    plan: [
      planEntry("QK-A-001", 1),
      planEntry("QK-A-002", 2),
      planEntry("QK-A-003", 3),
      planEntry("QK-A-004", 4),
      planEntry("QK-A-005", 5),
    ],
    tasks: [
      record("QK-A-001", "blocked"),
      record("QK-A-002", "partial", { verdict: "indeterminate" }),
      record("QK-A-003", "held"),
      record("QK-A-005", "failed"),
      record("QK-A-004", "released"),
    ],
  });

  const [needsYou] = buildRunReport(subject);
  expect(needsYou?.entries.map((entry) => entry.taskId)).toEqual([
    "QK-A-004", // rejected (released), plan order 4
    "QK-A-005", // rejected (failed),   plan order 5
    "QK-A-003", // held
    "QK-A-002", // indeterminate
    "QK-A-001", // blocked — collateral, last
  ]);
});

it("ordering does not depend on when records arrived", () => {
  const plan = [planEntry("QK-A-001", 1), planEntry("QK-A-002", 2), planEntry("QK-A-003", 3)];
  const records = [
    record("QK-A-001", "accepted"),
    record("QK-A-002", "failed"),
    record("QK-A-003", "partial"),
  ];
  const forwards = buildRunReport(run({ plan, tasks: records }));
  const backwards = buildRunReport(run({ plan, tasks: records.toReversed() }));
  expect(JSON.stringify(forwards)).toBe(JSON.stringify(backwards));
});

it("queued and running tasks land in IN FLIGHT, last", () => {
  const sections = buildRunReport(
    run({
      status: "running",
      plan: [planEntry("QK-A-001", 1), planEntry("QK-A-002", 2), planEntry("QK-A-003", 3)],
      tasks: [record("QK-A-001", "accepted"), record("QK-A-002", "running")],
    }),
  );
  expect(sections.map((section) => section.id)).toEqual(["accepted", "in-flight"]);
  expect(sections[1]?.entries.map((entry) => entry.taskId)).toEqual(["QK-A-002", "QK-A-003"]);
});

it("carries the runner's own words through to the section entry", () => {
  const quote =
    "I could not make the multi-repo scoping test pass\nwithout changing the registry contract.";
  const [needsYou] = buildRunReport(
    run({
      plan: [planEntry("QK-A-001", 1)],
      tasks: [
        record("QK-A-001", "failed", {
          verdict: "revise",
          reason: "review verdict revise",
          evidenceQuote: quote,
          dispatches: [
            dispatch({
              status: "failure",
              exitCode: 1,
              failureCode: "quota",
              failureMessage: "You have exceeded your usage limit.",
            }),
          ],
        }),
      ],
    }),
  );

  const entry = needsYou?.entries[0];
  // Byte-for-byte, newline included — nothing here reflows or trims a quote.
  expect(entry?.record.evidenceQuote).toBe(quote);
  expect(entry?.dispatches[0]?.failureMessage).toBe("You have exceeded your usage limit.");
  expect(entry?.dispatches[0]?.exitCode).toBe(1);
});

// ---------------------------------------------------------------------------
// dispatches
// ---------------------------------------------------------------------------

it("transport success is not a verdict", () => {
  expect(dispatchSucceeded(dispatch({ status: "success" }))).toBe(true);
  expect(dispatchSucceeded(dispatch({ status: "timeout" }))).toBe(false);
  expect(dispatchSucceeded(dispatch({ status: "cancelled" }))).toBe(false);
  expect(dispatchSucceeded(dispatch({ status: "failure" }))).toBe(false);
});

it("the last dispatch of a role is the attempt that produced the outcome", () => {
  const dispatches = [
    dispatch({ runner: "claude", model: "sonnet" }),
    dispatch({ runner: "codex", role: "reviewer", model: "gpt-5" }),
    dispatch({ runner: "cursor", model: "composer" }),
  ];
  expect(lastDispatch(dispatches)?.runner).toBe("cursor");
  expect(lastDispatch(dispatches, "implementer")?.runner).toBe("cursor");
  expect(lastDispatch(dispatches, "reviewer")?.runner).toBe("codex");
  expect(lastDispatch([], "reviewer")).toBe(null);
});

// ---------------------------------------------------------------------------
// the plan against what ran
// ---------------------------------------------------------------------------

it("pairs each plan row with what actually ran, and counts attempts", () => {
  const subject = run({
    plan: [planEntry("QK-A-001", 1, "claude", "sonnet", 2), planEntry("QK-A-002", 2)],
    tasks: [
      record("QK-A-001", "accepted", {
        dispatches: [
          dispatch({ runner: "claude", model: "sonnet" }),
          dispatch({ runner: "claude", model: "sonnet" }),
          dispatch({ runner: "codex", role: "reviewer", model: "gpt-5" }),
        ],
      }),
    ],
  });

  const [first, second] = planComparison(subject);
  expect(first?.actualRunner).toBe("claude");
  expect(first?.actualModel).toBe("sonnet");
  expect(first?.attempts).toBe(2);
  expect(first?.diverged).toBe(false);
  expect(first?.entry.estimatedCost).toBe(2);

  // Nothing ran: not a divergence, just a row nothing happened to.
  expect(second?.actualRunner).toBe(null);
  expect(second?.diverged).toBe(false);
  expect(second?.outcome).toBe("pending");
});

it("flags a row that ran on something other than the approved harness or model", () => {
  const subject = run({
    plan: [planEntry("QK-A-001", 1, "claude", "sonnet")],
    tasks: [
      record("QK-A-001", "accepted", {
        implementerModel: "opus",
        dispatches: [dispatch({ runner: "cursor", model: "composer" })],
      }),
    ],
  });
  const [row] = planComparison(subject);
  expect(row?.actualRunner).toBe("cursor");
  // The record's own implementerModel wins over the dispatch's — it is what
  // the parent decided to route to.
  expect(row?.actualModel).toBe("opus");
  expect(row?.diverged).toBe(true);
});

it("reads the plan in its own order, whatever order the rows are stored in", () => {
  const subject = run({
    plan: [planEntry("QK-A-003", 3), planEntry("QK-A-001", 1), planEntry("QK-A-002", 2)],
  });
  expect(planComparison(subject).map((row) => row.entry.id)).toEqual([
    "QK-A-001",
    "QK-A-002",
    "QK-A-003",
  ]);
});

// ---------------------------------------------------------------------------
// polling
// ---------------------------------------------------------------------------

it("polls a live run and stops dead on a terminal one", () => {
  const visible = { hidden: false, consecutiveFailures: 0 };
  expect(nextPollDelay({ status: "running", ...visible })).toBe(POLL_VISIBLE_MS);
  expect(nextPollDelay({ status: "approved", ...visible })).toBe(POLL_VISIBLE_MS);

  // Null is "stop", and it is what makes the live view become the report.
  expect(nextPollDelay({ status: "completed", ...visible })).toBe(null);
  expect(nextPollDelay({ status: "abandoned", ...visible })).toBe(null);
  expect(nextPollDelay({ status: "planned", ...visible })).toBe(null);
});

it("backs off for a hidden tab rather than pausing", () => {
  expect(nextPollDelay({ status: "running", hidden: true, consecutiveFailures: 0 })).toBe(
    POLL_HIDDEN_MS,
  );
  expect(POLL_HIDDEN_MS).toBeGreaterThan(POLL_VISIBLE_MS);
});

it("doubles on consecutive failures and never climbs past the ceiling", () => {
  const at = (consecutiveFailures: number, hidden = false): number | null =>
    nextPollDelay({ status: "running", hidden, consecutiveFailures });

  expect(at(0)).toBe(2_000);
  expect(at(1)).toBe(4_000);
  expect(at(2)).toBe(8_000);
  expect(at(3)).toBe(16_000);
  expect(at(4)).toBe(POLL_CEILING_MS);
  expect(at(40)).toBe(POLL_CEILING_MS);
  // A hidden tab that is also failing is already at the ceiling.
  expect(at(1, true)).toBe(POLL_CEILING_MS);
  // Nonsense input cannot produce a negative or fractional delay.
  expect(at(-5)).toBe(2_000);
});

it("a terminal run stops polling even while the daemon is failing", () => {
  expect(nextPollDelay({ status: "completed", hidden: false, consecutiveFailures: 3 })).toBe(null);
});

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

it("formats durations in the unit a person reads them in", () => {
  expect(formatDuration(0)).toBe("0ms");
  expect(formatDuration(420)).toBe("420ms");
  expect(formatDuration(1_500)).toBe("1.5s");
  expect(formatDuration(59_900)).toBe("59.9s");
  expect(formatDuration(252_000)).toBe("4m 12s");
  expect(formatDuration(3_601_000)).toBe("60m 01s");
  // Never a number invented out of nonsense.
  expect(formatDuration(Number.NaN)).toBe("—");
  expect(formatDuration(-1)).toBe("—");
});

it("elapsed is null when the run never started, and frozen once it finished", () => {
  expect(runElapsedMs(run({}))).toBe(null);
  expect(
    runElapsedMs(
      run({ startedAt: "2026-07-28T22:00:00.000Z", completedAt: "2026-07-28T22:12:00.000Z" }),
      Date.parse("2026-07-29T09:00:00.000Z"),
    ),
  ).toBe(720_000);
  // Still running: measured against now.
  expect(
    runElapsedMs(
      run({ startedAt: "2026-07-28T22:00:00.000Z" }),
      Date.parse("2026-07-28T22:05:00.000Z"),
    ),
  ).toBe(300_000);
});

it("an absent or unreadable stamp says so instead of showing now", () => {
  expect(formatStamp(undefined)).toBe("—");
  expect(formatStamp("")).toBe("—");
  expect(formatStamp("not a date")).toBe("not a date");
});
