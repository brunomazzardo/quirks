// One run — live AND retrospective (QK-WB-007, carried from QK-NAT-004).
//
// ONE VIEW, NOT TWO. The spec is explicit that "the native app's run-detail
// view renders the same data live during a run and retrospectively after it, so
// there is one shape, not two" (docs/specs/runs-goals-and-reports.md, D14). So
// this component is the retrospective report, and "live" is two additions to
// it: a timer that re-reads GET /v1/runs/:id, and a moss pulse that says so.
// When the run reaches a terminal status the timer stops and the pulse goes
// out — and what is left on screen is already the report.
//
// The ORDER is D14's and is not negotiable: NEEDS YOU → PARTIAL → ACCEPTED,
// never chronological, empty sections omitted. A chronological log of eight
// tasks is the wall of text this view exists to replace.
//
// The QUOTES are the honesty property. A verdict shows the runner's own
// sentence, quote-verified against the retained transcript; a failed dispatch
// shows the runner's own complaint with its exit code and the time it happened.
// Neither is summarised, softened, or truncated here — see components/
// run-chrome.tsx `Quote`.

import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { Run, RunDispatchRecord, RunStatus, RunTaskRecord } from "@quirks/contracts";
import type * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { EmptyState, LivePulse, Quote, Stat, toneClass } from "~/components/run-chrome";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { describeCause } from "~/lib/failure";
import {
  buildRunReport,
  dispatchSucceeded,
  formatClock,
  formatDuration,
  formatStamp,
  nextPollDelay,
  planComparison,
  type NeedsYouKind,
  type ReportSection,
  type RunEntry,
  runElapsedMs,
  runIsLive,
  runIsTerminal,
  runProgress,
  runTone,
} from "~/lib/runs";
import { cn } from "~/lib/utils";
import { runAtom } from "~/state/runs";

export function RunReport({ runId }: { runId: string }) {
  const atom = useMemo(() => runAtom(runId), [runId]);
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);

  const snapshot = Option.getOrNull(AsyncResult.value(result));
  const failure: Cause.Cause<Error> | null = AsyncResult.isFailure(result) ? result.cause : null;
  const run = snapshot?.run ?? null;

  useRunPoll(run?.status ?? null, failure !== null, refresh);

  if (run === null) {
    return failure === null ? (
      <EmptyState headline={result.waiting ? "reading the run…" : "no run data"} />
    ) : (
      <EmptyState headline={`no run ${runId}`} detail={describeCause(failure)} />
    );
  }

  const sections = buildRunReport(run);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <RunHeader
        run={run}
        fetchedAt={snapshot?.fetchedAt ?? null}
        waiting={result.waiting}
        onRefresh={refresh}
      />

      {failure !== null && (
        <p
          className="truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground transition-opacity duration-200 ease-out starting:opacity-0"
          title={describeCause(failure)}
        >
          showing the last good read — {describeCause(failure)}
        </p>
      )}

      {sections.length === 0 ? (
        <EmptyState
          headline="this run has no tasks"
          detail="nothing was approved into it, so there is nothing to report"
        />
      ) : (
        sections.map((section) => <Section key={section.id} section={section} />)
      )}

      <PlanTable run={run} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// the header — what this run is, and whether it is still moving
// ---------------------------------------------------------------------------

interface RunHeaderProps {
  run: Run;
  fetchedAt: Date | null;
  waiting: boolean;
  onRefresh: () => void;
}

function RunHeader({ run, fetchedAt, waiting, onRefresh }: RunHeaderProps) {
  const progress = runProgress(run);
  const tone = runTone(run);
  const live = runIsLive(run.status);
  const elapsed = runElapsedMs(run);

  return (
    <header className="flex flex-col gap-2 border-b pb-3">
      <div className="flex items-baseline gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight">{run.name}</h3>
        {live && <LivePulse />}
        <span className={cn("font-mono text-[11px]", toneClass(tone))}>{run.status}</span>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onRefresh}
          disabled={waiting}
          aria-label="Refresh run"
          title="Refresh"
        >
          <RefreshCw className={cn(waiting && "animate-spin")} />
        </Button>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
        <span>{run.slug}</span>
        {run.goal !== undefined && <span>goal {run.goal}</span>}
        <span>{run.mode}</span>
        <span>{progress.total} tasks</span>
        <span>started {run.startedAt === undefined ? "not yet" : formatStamp(run.startedAt)}</span>
        {run.completedAt !== undefined && <span>finished {formatStamp(run.completedAt)}</span>}
        {elapsed !== null && <span>{formatDuration(elapsed)} elapsed</span>}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Stat
          label="needs you"
          value={progress.needsYou}
          className={progress.needsYou > 0 ? "text-ember" : "text-muted-foreground"}
        />
        <Stat
          label="accepted"
          value={`${progress.accepted}/${progress.total}`}
          className={progress.accepted > 0 ? "text-moss" : "text-muted-foreground"}
        />
        {progress.partial > 0 && <Stat label="partial" value={progress.partial} />}
        {progress.running > 0 && (
          <Stat label="running" value={progress.running} className="text-moss" />
        )}
        {progress.pending > 0 && <Stat label="queued" value={progress.pending} />}

        {/* Say how live "live" is, and say when it stopped being a question. */}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {fetchedAt === null
            ? "—"
            : runIsTerminal(run.status)
              ? `final · read ${fetchedAt.toLocaleTimeString()}`
              : `read ${fetchedAt.toLocaleTimeString()}`}
        </span>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// sections and task records
// ---------------------------------------------------------------------------

function Section({ section }: { section: ReportSection }) {
  const needsYou = section.id === "needs-you";
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="flex items-center gap-2 px-1">
        <span
          className={cn(
            "font-mono text-[11px] font-medium tracking-wide",
            needsYou ? "text-ember" : "text-muted-foreground",
          )}
        >
          {section.label}
        </span>
        <Badge variant={needsYou ? "lamp" : "secondary"}>{section.entries.length}</Badge>
      </h4>
      <ul className="flex flex-col gap-1">
        {section.entries.map((entry) => (
          <li key={entry.taskId}>
            <TaskCard entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** D14's own marks. Decorative — the outcome word sits beside every one. */
const MARKS: Record<string, string> = {
  rejected: "✗",
  held: "⚠",
  indeterminate: "?",
  blocked: "⊘",
  partial: "◐",
  accepted: "✓",
  running: "▸",
  pending: "·",
  released: "✗",
};

function markFor(entry: RunEntry): string {
  if (entry.needs !== null) return MARKS[entry.needs] ?? "·";
  return MARKS[entry.record.outcome] ?? "·";
}

/** What the outcome word means when the word alone is ambiguous. */
const NEEDS_YOU_DETAIL: Record<NeedsYouKind, string> = {
  rejected: "rejected — the work was not accepted",
  held: "held after a verified landing — never unassigned (D13)",
  indeterminate: "verdict could not be read from the transcript",
  blocked: "blocked by a failed dependency in this run",
};

function TaskCard({ entry }: { entry: RunEntry }) {
  const { record } = entry;
  const attention = entry.needs !== null;

  return (
    <article
      className={cn(
        "flex flex-col gap-1 rounded-md border-l-2 bg-card px-2.5 py-2",
        attention ? "border-l-ember" : "border-l-transparent",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span aria-hidden="true" className={cn("font-mono text-[11px]", attention && "text-ember")}>
          {markFor(entry)}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{entry.taskId}</span>
        <span className="min-w-0 flex-1 truncate text-xs">{entry.title}</span>
        <span
          className={cn(
            "shrink-0 font-mono text-[10px]",
            attention
              ? "text-ember"
              : record.outcome === "accepted"
                ? "text-moss"
                : "text-muted-foreground",
          )}
          title={entry.needs === null ? undefined : NEEDS_YOU_DETAIL[entry.needs]}
        >
          {record.outcome}
        </span>
        {record.verdict !== undefined && (
          <span
            className={cn(
              "shrink-0 font-mono text-[10px]",
              record.verdict === "accept" ? "text-moss" : "text-ember",
            )}
          >
            verdict {record.verdict}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pl-5 font-mono text-[10px] text-muted-foreground">
        {entry.unrecorded && (
          <span title="in the approved plan; no record was ever written">never dispatched</span>
        )}
        {record.landingCommit !== null && <span>landed {record.landingCommit.slice(0, 8)}</span>}
        {record.worktree !== null && <span className="truncate">worktree {record.worktree}</span>}
        {record.continuationPath !== undefined && (
          <span className="truncate">continuation {record.continuationPath}</span>
        )}
      </div>

      {record.reason !== undefined && record.reason.trim().length > 0 && (
        <p className="pl-5 font-mono text-[10px] break-words text-muted-foreground">
          reason: {record.reason}
        </p>
      )}

      {record.evidenceQuote !== undefined && record.evidenceQuote.trim().length > 0 && (
        <div className="pl-5">
          <Quote
            text={record.evidenceQuote}
            tone={record.verdict === "accept" ? "lamp" : "ember"}
            source="the runner's own words — quote-verified against the retained transcript"
          />
        </div>
      )}

      <Dispatches record={record} />
    </article>
  );
}

// ---------------------------------------------------------------------------
// dispatch history — did codex answer tonight, and what did it say
// ---------------------------------------------------------------------------

function Dispatches({ record }: { record: RunTaskRecord }) {
  const dispatches = record.dispatches ?? [];
  if (dispatches.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5 pt-1 pl-5">
      <span className="font-mono text-[10px] text-muted-foreground">
        dispatches ({dispatches.length})
      </span>
      <ul className="flex flex-col">
        {/* A dispatch has no id of its own. The list is append-only and never
            reorders, so the dated facts it does carry are identity enough. */}
        {dispatches.map((dispatch) => (
          <li key={dispatchKey(dispatch)}>
            <DispatchRow dispatch={dispatch} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function dispatchKey(dispatch: RunDispatchRecord): string {
  return [
    dispatch.dispatchedAt,
    dispatch.runner,
    dispatch.role,
    dispatch.model,
    dispatch.durationMs,
  ].join("|");
}

function DispatchRow({ dispatch }: { dispatch: RunDispatchRecord }) {
  const ok = dispatchSucceeded(dispatch);
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-0.5 font-mono text-[10px]">
        <span className="text-muted-foreground tabular-nums">
          {formatClock(dispatch.dispatchedAt)}
        </span>
        <span className="text-foreground">{dispatch.runner}</span>
        <span className="text-muted-foreground">{dispatch.role}</span>
        <span className="text-muted-foreground">{dispatch.model}</span>
        <span className={ok ? "text-moss" : "text-ember"}>{dispatch.status}</span>
        {/* The exit code rides with the failure, always. A failed dispatch
            shown without it is a story missing its evidence. */}
        <span className={cn("tabular-nums", ok ? "text-muted-foreground" : "text-ember")}>
          exit {dispatch.exitCode === null ? "—" : dispatch.exitCode}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {formatDuration(dispatch.durationMs)}
        </span>
        {dispatch.failureCode !== undefined && (
          <span className="text-ember">{dispatch.failureCode}</span>
        )}
      </div>

      {dispatch.failureMessage !== undefined && dispatch.failureMessage.trim().length > 0 && (
        <Quote
          text={dispatch.failureMessage}
          tone="ember"
          source={`${dispatch.runner} (${dispatch.model}) at ${formatStamp(dispatch.dispatchedAt)}`}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// the plan, against what actually ran
// ---------------------------------------------------------------------------

function PlanTable({ run }: { run: Run }) {
  const rows = planComparison(run);
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="flex items-center gap-2 px-1">
        <span className="font-mono text-[11px] font-medium tracking-wide text-muted-foreground">
          THE PLAN
        </span>
        <Badge>{rows.length}</Badge>
        <span className="font-mono text-[10px] text-muted-foreground">
          what was approved, beside what actually ran
        </span>
      </h4>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-max border-collapse font-mono text-[10px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-2 py-1.5 font-normal">#</th>
              <th className="px-2 py-1.5 font-normal">task</th>
              <th className="px-2 py-1.5 font-normal">harness</th>
              <th className="px-2 py-1.5 font-normal">model</th>
              <th className="px-2 py-1.5 font-normal">est.</th>
              <th className="px-2 py-1.5 font-normal">ran as</th>
              <th className="px-2 py-1.5 font-normal">outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.entry.id} className="border-b last:border-b-0">
                <td className="px-2 py-1.5 text-muted-foreground tabular-nums">
                  {row.entry.order}
                </td>
                <td className="px-2 py-1.5">
                  <span className="text-muted-foreground">{row.entry.id}</span>
                  <span className="pl-2 font-sans text-[11px] text-foreground">
                    {row.entry.title}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{row.entry.harness}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{row.entry.model}</td>
                {/* Null means unknown — never invent a number (domain.ts). */}
                <td className="px-2 py-1.5 text-muted-foreground tabular-nums">
                  {row.entry.estimatedCost === null ? "?" : row.entry.estimatedCost}
                </td>
                <td className={cn("px-2 py-1.5", row.diverged ? "text-lamp" : "text-foreground")}>
                  {row.actualRunner === null ? (
                    <span className="text-muted-foreground">not dispatched</span>
                  ) : (
                    <>
                      {row.diverged && (
                        <span aria-hidden="true" title="differs from the approved plan">
                          ≠{" "}
                        </span>
                      )}
                      {row.actualRunner}/{row.actualModel ?? "?"}
                      {row.attempts > 1 && (
                        <span className="pl-1 text-muted-foreground">×{row.attempts}</span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{row.outcome ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// polling — the whole of "live"
// ---------------------------------------------------------------------------

/**
 * Re-read GET /v1/runs/:id on a schedule, and stop for good when the run
 * settles. Runs have no SSE (unlike /shape), so this is the only live path
 * there is; the schedule itself is pure and tested in lib/runs.test.ts.
 *
 * Three properties worth stating out loud:
 *
 *   TERMINAL STOPS IT. `nextPollDelay` returns null for completed/abandoned,
 *   the loop simply does not reschedule, and what remains on screen is the
 *   retrospective. Nothing tears down, nothing re-mounts.
 *
 *   A HIDDEN TAB BACKS OFF rather than pausing — 2s becomes 15s — and a tab
 *   that comes BACK reads immediately instead of serving the reader a
 *   fifteen-second-old page while it waits for its next tick.
 *
 *   A FAILING DAEMON BACKS OFF EXPONENTIALLY to a 30s ceiling and resets on
 *   the first success. The view keeps the last good read on screen throughout
 *   (AsyncResult carries value and failure together) and says so, rather than
 *   blanking every two seconds while the daemon is down.
 */
function useRunPoll(status: RunStatus | null, failing: boolean, refresh: () => void): void {
  const failures = useRef(0);
  const failingNow = useRef(failing);

  useEffect(() => {
    failingNow.current = failing;
  }, [failing]);

  useEffect(() => {
    if (status === null) return;
    let timer: number | undefined;
    let cancelled = false;

    const schedule = (): void => {
      const delay = nextPollDelay({
        status,
        hidden: typeof document === "undefined" ? false : document.hidden,
        consecutiveFailures: failures.current,
      });
      if (delay === null) return;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        failures.current = failingNow.current ? failures.current + 1 : 0;
        refresh();
        schedule();
      }, delay);
    };

    const onVisibilityChange = (): void => {
      window.clearTimeout(timer);
      if (cancelled) return;
      if (!document.hidden) {
        failures.current = 0;
        refresh();
      }
      schedule();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [status, refresh]);
}
