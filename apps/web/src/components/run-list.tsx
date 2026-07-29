// Every run, newest first (QK-WB-007 / the abandoned QK-NAT-004's "Runs" view).
//
// A list row answers one question — is there anything here I have to act on? —
// so the needs-you count is the only thing on it allowed to be ember, and it
// leads the counts even though it is usually zero. Same rule as the report it
// links to: failures first, never chronological.

import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useMemo } from "react";

import { EmptyState, LivePulse, Stat, toneClass } from "~/components/run-chrome";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { buildRunRows, formatStamp, type RunProgress, type RunRow } from "~/lib/runs";
import { cn } from "~/lib/utils";
import { runsAtom } from "~/state/runs";
import { describeCause } from "~/lib/failure";

export function RunList() {
  const result = useAtomValue(runsAtom);
  const refresh = useAtomRefresh(runsAtom);

  const snapshot = Option.getOrNull(AsyncResult.value(result));
  const rows = useMemo(() => (snapshot === null ? [] : buildRunRows(snapshot.runs)), [snapshot]);
  const failure: Cause.Cause<Error> | null = AsyncResult.isFailure(result) ? result.cause : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 p-4">
      <div className="flex items-center gap-2 px-1">
        <h3 className="text-xs font-medium tracking-tight">Runs</h3>
        {snapshot !== null && <Badge>{rows.length}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          {snapshot !== null && (
            <span className="font-mono text-[10px] text-muted-foreground">
              read {snapshot.fetchedAt.toLocaleTimeString()}
            </span>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={refresh}
            disabled={result.waiting}
            aria-label="Refresh runs"
            title="Refresh"
          >
            <RefreshCw className={cn(result.waiting && "animate-spin")} />
          </Button>
        </div>
      </div>

      {snapshot === null ? (
        failure === null ? (
          <EmptyState headline={result.waiting ? "reading runs…" : "no run data"} />
        ) : (
          <EmptyState headline="runs not reachable" detail={describeCause(failure)} />
        )
      ) : (
        <>
          {failure !== null && (
            <p
              className="truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground transition-opacity duration-200 ease-out starting:opacity-0"
              title={describeCause(failure)}
            >
              showing the last good read — {describeCause(failure)}
            </p>
          )}

          {rows.length === 0 ? (
            // Honest and quiet: an empty ledger is not an error, and the way a
            // run comes to exist is a CLI verb, not a button in here — the CLI
            // is still the one mutation path (QK-NAT-007's rule, unchanged).
            <EmptyState
              headline="no runs recorded"
              detail="a run is created by `quirks run --goal <id> --name <name>`; it appears here the moment it is approved"
            />
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map((row) => (
                <li key={row.run.id}>
                  <RunRowLink row={row} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function RunRowLink({ row }: { row: RunRow }) {
  const { run, progress, tone, live } = row;

  return (
    <Link
      to="/runs/$runId"
      params={{ runId: run.slug.length > 0 ? run.slug : run.id }}
      className="flex flex-col gap-1.5 rounded-md border-l-2 border-transparent px-2.5 py-2 hover:border-l-lamp hover:bg-accent"
    >
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{run.name}</span>
        {live && <LivePulse />}
        <span className={cn("shrink-0 font-mono text-[10px]", toneClass(tone))}>{run.status}</span>
        <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
      </span>

      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
        <span>{run.slug}</span>
        {run.goal !== undefined && <span>goal {run.goal}</span>}
        <span>{run.mode}</span>
        <span>started {run.startedAt === undefined ? "not yet" : formatStamp(run.startedAt)}</span>
      </span>

      <ProgressBar progress={progress} />

      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* Leads even at zero: "nothing needs you" is the answer this row
            exists to give, and a count that only appears when it is bad is a
            count you cannot trust when it is absent. */}
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
      </span>
    </Link>
  );
}

/**
 * The run at a glance: ember for what needs you, moss for what landed, a muted
 * remainder for what has not happened. Proportional to the APPROVED plan, not
 * to what has been recorded so far — a bar that renormalised as records
 * arrived would show a half-finished run as complete.
 */
function ProgressBar({ progress }: { progress: RunProgress }) {
  if (progress.total === 0) return null;
  const segments: ReadonlyArray<readonly [string, number, string]> = [
    ["needs you", progress.needsYou, "bg-ember"],
    ["accepted", progress.accepted, "bg-moss"],
    ["partial", progress.partial, "bg-lamp"],
    ["running", progress.running, "bg-moss/40"],
  ];
  const done = segments.reduce((sum, [, count]) => sum + count, 0);

  return (
    <span
      className="flex h-1 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={`${progress.accepted} accepted, ${progress.needsYou} need you, of ${progress.total} tasks`}
    >
      {segments.map(([label, count, className]) =>
        count === 0 ? null : (
          <span
            key={label}
            // Width, knowingly: the bar is a self-contained 4px flex row, so
            // the layout cost is negligible, and a segment that glides on a
            // poll refresh is the state change made visible.
            className={cn(className, "transition-[width] duration-400 ease-in-out")}
            style={{ width: `${(count / progress.total) * 100}%` }}
          />
        ),
      )}
      {done < progress.total && <span className="flex-1" />}
    </span>
  );
}
