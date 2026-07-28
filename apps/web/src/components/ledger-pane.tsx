import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  ListChecks,
  ListFilter,
  RefreshCw,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import {
  buildInbox,
  DEFAULT_VIEW,
  filterGoals,
  type GoalFilter,
  type InboxGroup,
  inboxCount,
  type LedgerView,
  type Ordering,
  type StatusFilter,
  statusTone,
  type StatusTone,
  viewDirty,
} from "~/lib/ledger";
import { cn } from "~/lib/utils";
import { ledgerAtom } from "~/state/ledger";

/**
 * The ledger pane (QK-WB-003) — the native workbench's left rail against the
 * HTTP service, recreating three tasks' worth of behavior:
 *
 *  QK-NAT-007  Goals and Tasks as accordion sections; density-A rows (title
 *              primary, muted mono id, status as a compact chip); selection
 *              lives in local state only — no write verbs, the CLI is still
 *              the one mutation path.
 *  QK-NAT-011  notes-style density: roomy row padding, muted section labels
 *              with count badges.
 *  QK-NAT-012  the Tasks section IS the inbox — open tasks grouped by goal
 *              with per-goal headers and an Other bucket, filtered from a
 *              View menu rather than an always-on chip row.
 *
 * Theme fidelity (geist pack, night-ledger lamp accent) is QK-WB-006's; this
 * stays on the zinc tokens already in src/index.css, so "amber when filters
 * leave default" is here as a primary-tone `filt` badge for now.
 */
export function LedgerPane() {
  const result = useAtomValue(ledgerAtom);
  const refresh = useAtomRefresh(ledgerAtom);

  const [view, setView] = useState<LedgerView>(DEFAULT_VIEW);
  const [goalsOpen, setGoalsOpen] = useState(true);
  const [tasksOpen, setTasksOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const snapshot = Option.getOrNull(AsyncResult.value(result));
  const goals = useMemo(
    () => (snapshot === null ? [] : filterGoals(snapshot.goals, view.goalFilter)),
    [snapshot, view.goalFilter],
  );
  const inbox = useMemo(
    () => (snapshot === null ? [] : buildInbox(snapshot.goals, snapshot.tasks, view)),
    [snapshot, view],
  );

  const toggleSection = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsed(new Set(inbox.map((group) => group.id)));
  }, [inbox]);

  const taskCount = inboxCount(inbox);
  const dirty = viewDirty(view);
  const failure = AsyncResult.isFailure(result) ? describe(result.cause) : null;

  return (
    <section className="flex min-w-0 flex-1 flex-col rounded-lg border bg-card text-card-foreground">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3 [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
        <ListChecks />
        <h2 className="text-xs font-medium tracking-tight">Ledger</h2>
        {snapshot !== null && <Badge>{taskCount}</Badge>}
        {dirty && (
          <Badge variant="default" title="the View menu has left its defaults">
            filt
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-1">
          <ViewMenu
            view={view}
            onChange={setView}
            onReset={() => setView(DEFAULT_VIEW)}
            onCollapseAll={collapseAll}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={refresh}
            disabled={result.waiting}
            aria-label="Refresh ledger"
            title={
              snapshot === null
                ? "Refresh"
                : `Refresh — read ${snapshot.fetchedAt.toLocaleTimeString()}`
            }
          >
            <RefreshCw className={cn(result.waiting && "animate-spin")} />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2.5">
        {snapshot === null ? (
          <Placeholder failure={failure} waiting={result.waiting} onRetry={refresh} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {failure !== null && <StaleNotice reason={failure} />}

            <SectionHeader
              label="Goals"
              count={goals.length}
              open={goalsOpen}
              onToggle={() => setGoalsOpen((open) => !open)}
            />
            {goalsOpen &&
              (goals.length === 0 ? (
                <EmptyRow>no goals match this view</EmptyRow>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {goals.map((goal) => (
                    <li key={goal.id}>
                      <div className="flex items-center gap-2 rounded-md px-2.5 py-1.5">
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {goal.id}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {goal.title ?? goal.id}
                        </span>
                        <span
                          className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums"
                          title={`${goal.done} done · ${goal.open} open · ${goal.blocked} blocked · ${goal.future} future`}
                        >
                          {goal.done}/{goal.total}
                        </span>
                        <StatusChip label={goal.state} tone={statusTone(goal.state)} />
                      </div>
                    </li>
                  ))}
                </ul>
              ))}

            <SectionHeader
              label="Tasks"
              count={taskCount}
              open={tasksOpen}
              onToggle={() => setTasksOpen((open) => !open)}
            />
            {tasksOpen &&
              (inbox.length === 0 ? (
                <EmptyRow>no tasks match this view</EmptyRow>
              ) : (
                inbox.map((group) => (
                  <InboxSection
                    key={group.id}
                    group={group}
                    expanded={!collapsed.has(group.id)}
                    onToggle={() => toggleSection(group.id)}
                    selectedTaskId={selectedTaskId}
                    onSelect={setSelectedTaskId}
                  />
                ))
              ))}

            {/* NAT-007's "later Runs header stub only" — QK-WB-007 fills it. */}
            <div className="mt-1 border-t pt-1.5">
              <div className="flex h-8 items-center gap-2 px-2.5">
                <CircleDot className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-xs text-muted-foreground">Runs</span>
                <Badge>soon</Badge>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// accordion + rows
// ---------------------------------------------------------------------------

interface SectionHeaderProps {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}

/**
 * QK-NAT-011: both sections carry identical header chrome — muted label plus a
 * count badge — so collapsing one never changes the rail's width or rhythm.
 */
function SectionHeader({ label, count, open, onToggle }: SectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-accent"
    >
      <Chevron open={open} />
      <span className="flex-1 text-xs font-medium">{label}</span>
      <Badge>{count}</Badge>
    </button>
  );
}

interface InboxSectionProps {
  group: InboxGroup;
  expanded: boolean;
  onToggle: () => void;
  selectedTaskId: string | null;
  onSelect: (id: string) => void;
}

/** QK-NAT-012: one goal's header plus its tasks; collapsible per goal. */
function InboxSection({ group, expanded, onToggle, selectedTaskId, onSelect }: InboxSectionProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
      >
        <Chevron open={expanded} className="mt-0.5" />
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-xs font-medium">{group.title}</span>
          <span className="truncate font-mono text-[10px] text-muted-foreground">
            {group.goalId === null ? group.state : `${group.goalId} · ${group.state}`}
          </span>
        </span>
        <Badge className="mt-0.5">{group.tasks.length}</Badge>
      </button>

      {expanded && (
        <ul className="flex flex-col gap-0.5">
          {group.tasks.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                onClick={() => onSelect(task.id)}
                aria-current={task.id === selectedTaskId}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left hover:bg-accent",
                  task.id === selectedTaskId && "bg-accent",
                )}
              >
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs">{task.title}</span>
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[10px]",
                      task.tone === "live" ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {task.status}
                  </span>
                </span>
                <span className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[10px] text-muted-foreground">{task.id}</span>
                  {task.future && (
                    <span
                      className="font-mono text-[10px] text-muted-foreground/70"
                      title="deliberately not now — excluded from open counts"
                    >
                      future
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chevron({ open, className }: { open: boolean; className?: string }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <Icon aria-hidden="true" className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />
  );
}

function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <Badge variant={tone === "live" ? "default" : "secondary"} className="shrink-0">
      {label}
    </Badge>
  );
}

function EmptyRow({ children }: { children: string }) {
  return <p className="px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground">{children}</p>;
}

// ---------------------------------------------------------------------------
// the View menu — the native's dropdown, option for option
// ---------------------------------------------------------------------------

interface ViewMenuProps {
  view: LedgerView;
  onChange: (view: LedgerView) => void;
  onReset: () => void;
  onCollapseAll: () => void;
}

/**
 * QK-NAT-012's View control: Ordering, Status and Goal-state axes plus Reset
 * and Collapse All, and nothing always-on in the default chrome. The native
 * listed flat "Ordering · Updated" items because its markup had no radio
 * group; base-ui does, so the same options are grouped and labelled — same
 * axes, same defaults, same effect.
 */
function ViewMenu({ view, onChange, onReset, onCollapseAll }: ViewMenuProps) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button size="xs" variant="ghost" aria-label="View options">
            <ListFilter />
            View
          </Button>
        }
      />
      <MenuPopup className="min-w-44">
        <MenuGroup>
          <MenuGroupLabel>Ordering</MenuGroupLabel>
          <MenuRadioGroup
            value={view.ordering}
            onValueChange={(value) => onChange({ ...view, ordering: value as Ordering })}
          >
            <MenuRadioItem value="updated">Updated</MenuRadioItem>
            <MenuRadioItem value="status">Status</MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>

        <MenuSeparator />

        <MenuGroup>
          <MenuGroupLabel>Status</MenuGroupLabel>
          <MenuRadioGroup
            value={view.statusFilter}
            onValueChange={(value) => onChange({ ...view, statusFilter: value as StatusFilter })}
          >
            <MenuRadioItem value="active">Active</MenuRadioItem>
            <MenuRadioItem value="done">Done</MenuRadioItem>
            <MenuRadioItem value="all">All</MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>

        <MenuSeparator />

        <MenuGroup>
          <MenuGroupLabel>Goals</MenuGroupLabel>
          <MenuRadioGroup
            value={view.goalFilter}
            onValueChange={(value) => onChange({ ...view, goalFilter: value as GoalFilter })}
          >
            <MenuRadioItem value="progress">In progress</MenuRadioItem>
            <MenuRadioItem value="idle">Idle</MenuRadioItem>
            <MenuRadioItem value="all">All</MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>

        <MenuSeparator />

        <MenuItem onClick={onReset}>Reset filters</MenuItem>
        <MenuItem onClick={onCollapseAll}>Collapse all</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

// ---------------------------------------------------------------------------
// quiet, honest empty states
// ---------------------------------------------------------------------------

interface PlaceholderProps {
  failure: string | null;
  waiting: boolean;
  onRetry: () => void;
}

/**
 * Before the first successful read there is nothing to show but the truth:
 * connecting, or why not. The native rail said this in one badge
 * ("loading" / "daemon unreachable"); the same two states, with the reason
 * kept rather than flattened.
 */
function Placeholder({ failure, waiting, onRetry }: PlaceholderProps) {
  if (failure === null) {
    return (
      <p className="px-1 py-2 font-mono text-xs text-muted-foreground">
        {waiting ? "reading the ledger…" : "no ledger data"}
      </p>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="font-mono text-xs text-muted-foreground">ledger not reachable</p>
      <p className="max-w-full truncate font-mono text-[10px] text-muted-foreground/70">
        {failure}
      </p>
      <Button size="xs" variant="outline" onClick={onRetry} disabled={waiting} className="mt-1">
        <RefreshCw />
        Retry
      </Button>
    </div>
  );
}

/** A refresh failed but the last good read is still on screen — say so. */
function StaleNotice({ reason }: { reason: string }) {
  return (
    <p
      className="truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground"
      title={reason}
    >
      showing the last good read — {reason}
    </p>
  );
}

function describe(cause: Cause.Cause<Error>): string {
  const error = Cause.squash(cause);
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "the ledger request failed";
}
