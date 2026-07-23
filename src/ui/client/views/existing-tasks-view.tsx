import { useMemo, useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import type { UiExistingTasksV1 } from "../../read-models/existing-tasks.js";
import type { UiPromptSetV1 } from "../../../prompt/types.js";
import { classifyUrl } from "../../security/url-policy.js";
import { DataTable } from "../components/data-table.js";
import { Panel } from "../components/panel.js";
import { PromptActions } from "../components/prompt-actions.js";
import { StatusBadge, type StatusTone } from "../components/status-badge.js";
import { SummaryStat } from "../components/summary-stat.js";
import { SyncBanner } from "../components/sync-banner.js";
import { WorkspaceHeader } from "../components/workspace-header.js";

type ExistingTask = UiExistingTasksV1["tasks"][number];

// classifyUrl only needs a real authority to validate loopback-http links; existing task
// source links are either https or absent, so a placeholder authority never matters here.
const NO_AUTHORITY = "";

const READINESS_LABEL: Record<ExistingTask["readiness"], string> = {
  ready: "Ready",
  blocked: "Blocked",
  claimed: "Claimed",
  ineligible: "Ineligible",
  conflict: "Conflict",
};

const READINESS_TONE: Record<ExistingTask["readiness"], StatusTone> = {
  ready: "success",
  blocked: "warning",
  claimed: "info",
  ineligible: "neutral",
  conflict: "danger",
};

const FRONTIER_CARD_CLASS: Record<ExistingTask["readiness"], string> = {
  ready: "mini-card mini-card--ready",
  blocked: "mini-card mini-card--blocked",
  claimed: "mini-card mini-card--claimed",
  ineligible: "mini-card mini-card--blocked",
  conflict: "mini-card mini-card--conflict",
};

const READINESS_FILTERS = ["all", "ready", "blocked", "design", "claimed"] as const;
type ReadinessFilter = (typeof READINESS_FILTERS)[number];

const FILTER_LABEL: Record<ReadinessFilter, string> = {
  all: "All states",
  ready: "Ready",
  blocked: "Blocked",
  design: "Needs design",
  claimed: "Claimed",
};

function matchesFilter(task: ExistingTask, filter: ReadinessFilter): boolean {
  if (filter === "all") return true;
  if (filter === "design") return task.designGate.required;
  return task.readiness === filter;
}

/** v4 tint precedence: a design gate is amber, not just another gray block. */
function needsDesign(task: ExistingTask): boolean {
  return task.designGate.required && task.readiness === "blocked";
}

function frontierCardClass(task: ExistingTask): string {
  if (needsDesign(task)) return "mini-card mini-card--design";
  return FRONTIER_CARD_CLASS[task.readiness];
}

function frontierCardLabel(task: ExistingTask): string {
  if (needsDesign(task)) return "Needs design";
  return READINESS_LABEL[task.readiness];
}

const FRONTIER_CARD_LIMIT = 5;

function isOpen(task: ExistingTask): boolean {
  return task.status !== "completed" && task.status !== "cancelled";
}

/**
 * v4 frontier columns by dependency depth: FOUNDATIONS (no unfinished
 * prerequisites in the projection), NEXT WAVE (prerequisites are all
 * foundations), LATER (deeper chains). Derived from dependsOn only.
 */
function frontierColumns(tasks: readonly ExistingTask[]): [ExistingTask[], ExistingTask[], ExistingTask[]] {
  const open = tasks.filter(isOpen);
  const openIds = new Set(open.map((task) => task.id));
  const depth = new Map<string, number>();
  const resolve = (task: ExistingTask, trail: ReadonlySet<string>): number => {
    const known = depth.get(task.id);
    if (known !== undefined) return known;
    const prerequisites = task.dependsOn.filter((id) => openIds.has(id) && !trail.has(id));
    let value = 0;
    if (prerequisites.length > 0) {
      const nextTrail = new Set([...trail, task.id]);
      value =
        1 +
        Math.max(
          ...prerequisites.map((id) => resolve(open.find((entry) => entry.id === id)!, nextTrail)),
        );
    }
    const bounded = Math.min(value, 2);
    depth.set(task.id, bounded);
    return bounded;
  };
  const columns: [ExistingTask[], ExistingTask[], ExistingTask[]] = [[], [], []];
  for (const task of open) columns[resolve(task, new Set([task.id])) as 0 | 1 | 2].push(task);
  return columns;
}

function FrontierColumn({ label, tasks }: { label: string; tasks: readonly ExistingTask[] }) {
  const visible = tasks.slice(0, FRONTIER_CARD_LIMIT);
  return (
    <div className="wave-col">
      <div className="wave-col-label">{label}</div>
      {visible.length === 0 ? <p className="cell-note">None</p> : null}
      {visible.map((task) => (
        <div key={task.id} className={frontierCardClass(task)}>
          {`${task.id} · ${frontierCardLabel(task)}`}
        </div>
      ))}
      {tasks.length > visible.length ? <p className="cell-note">{`+${tasks.length - visible.length} more`}</p> : null}
    </div>
  );
}

const columnHelper = createColumnHelper<ExistingTask>();

function buildColumns(onSelect: (taskId: string) => void) {
  return [
    columnHelper.display({
      id: "task",
      header: "Task",
      cell: (info) => (
        <button type="button" className="task-select" onClick={() => onSelect(info.row.original.id)}>
          <strong>{info.row.original.id}</strong>
          <span className="task-subtitle">{info.row.original.title}</span>
        </button>
      ),
    }),
    columnHelper.display({
      id: "readiness",
      header: "State",
      cell: (info) => (
        <StatusBadge
          label={READINESS_LABEL[info.row.original.readiness]}
          tone={READINESS_TONE[info.row.original.readiness]}
        />
      ),
    }),
    columnHelper.display({
      id: "dependencies",
      header: "Dependencies",
      cell: (info) => {
        const task = info.row.original;
        if (task.dependsOn.length === 0 && task.blockers.length === 0) return <span>—</span>;
        return (
          <div>
            {task.dependsOn.length > 0 ? <span>{`Requires ${task.dependsOn.join(", ")}`}</span> : null}
            {task.blockers.map((blocker) => (
              <span key={blocker} className="cell-note">
                {blocker}
              </span>
            ))}
          </div>
        );
      },
    }),
    columnHelper.display({
      id: "risk-effort",
      header: "Risk / effort",
      cell: (info) => {
        const task = info.row.original;
        return <span>{`${task.risk.length > 0 ? task.risk.join(", ") : "—"} / ${task.effort}`}</span>;
      },
    }),
    columnHelper.display({
      id: "route",
      header: "Suggested route",
      cell: (info) => <span>{info.row.original.suggestedRoute.label}</span>,
    }),
  ];
}

function TaskInspector({ task }: { task: ExistingTask }) {
  const classified = task.source.webUrl ? classifyUrl(task.source.webUrl, NO_AUTHORITY) : null;
  return (
    <div>
      <span className="micro-label">{`SELECTED TASK · ${task.id}`}</span>
      <h2>{task.title}</h2>
      <p>
        <StatusBadge label={READINESS_LABEL[task.readiness]} tone={READINESS_TONE[task.readiness]} />
      </p>
      <div className="score-row">
        <div className="score-cell">
          <span>Risk</span>
          <strong>{task.risk.length > 0 ? task.risk.join(", ") : "None"}</strong>
        </div>
        <div className="score-cell">
          <span>Effort</span>
          <strong>{task.effort}</strong>
        </div>
        <div className="score-cell">
          <span>Priority</span>
          <strong>{task.priority}</strong>
        </div>
      </div>
      <span className="detail-label">Why this route</span>
      <div className="reason-box">
        <strong>{task.suggestedRoute.label}</strong>
        {`Suggested ${task.suggestedRoute.tier} tier for ${task.kind} work in the ${task.workflowPhase} phase.`}
      </div>
      {task.designGate.required ? (
        <>
          <span className="detail-label">Design gate</span>
          <p>{task.designGate.mode === "delegated" ? "Delegated approval allowed" : "Human approval required"}</p>
        </>
      ) : null}
      {task.dependsOn.length > 0 || task.blockers.length > 0 ? (
        <>
          <span className="detail-label">Dependencies</span>
          {task.dependsOn.length > 0 ? <p>{`Requires ${task.dependsOn.join(", ")}`}</p> : null}
          {task.blockers.map((blocker) => (
            <p key={blocker} className="cell-note">
              {blocker}
            </p>
          ))}
        </>
      ) : null}
      <span className="detail-label">Source of truth</span>
      <p>{`${task.source.driver}: ${task.source.nativeId} · revision ${task.nativeRevision}`}</p>
      <p>
        {task.coordination
          ? `Claimed by ${task.coordination.owner} (${task.coordination.campaignId})`
          : "Unclaimed"}
        {" · no task state changes from viewing or selecting."}
      </p>
      {classified && classified.kind === "https" ? (
        <p>
          <a href={classified.href} target="_blank" rel="noreferrer noopener">
            Open source
          </a>
        </p>
      ) : null}
    </div>
  );
}

export interface ExistingTasksViewProps {
  projection: UiExistingTasksV1;
  /** State-valid copy actions for the selected task, when the server offers any. */
  promptSet?: UiPromptSetV1;
}

export function ExistingTasksView({ projection, promptSet }: ExistingTasksViewProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>("all");

  const tasks = projection.tasks;
  const columns = useMemo(() => buildColumns(setSelectedTaskId), []);
  const [foundations, nextWave, later] = useMemo(() => frontierColumns(tasks), [tasks]);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (!matchesFilter(task, readinessFilter)) return false;
      if (normalizedSearch.length === 0) return true;
      return `${task.id} ${task.title}`.toLowerCase().includes(normalizedSearch);
    });
  }, [tasks, readinessFilter, normalizedSearch]);

  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) ?? null : null;

  const openCount = tasks.filter(isOpen).length;
  const readyCount = tasks.filter((task) => task.readiness === "ready").length;
  const blockedCount = tasks.filter((task) => task.readiness === "blocked").length;
  const designGateCount = tasks.filter((task) => task.designGate.required && isOpen(task)).length;
  const claimedCount = tasks.filter((task) => task.coordination !== null).length;

  return (
    <section aria-labelledby="existing-tasks-heading">
      <WorkspaceHeader
        eyebrow="LOCAL CONTROL UI"
        title="Existing tasks"
        headingId="existing-tasks-heading"
        description="Repository-scoped read model. The task source stays authoritative."
      />
      <SyncBanner
        pending={projection.source.pendingWrites}
        conflicts={projection.source.conflicts}
        syncHealth={projection.source.syncHealth}
        coordinationNotice={projection.coordinationNotice}
        leaseNotice={projection.leaseNotice}
        refreshedAt={projection.refreshedAt}
      />
      <div className="summary-grid">
        <SummaryStat label="Open" value={String(openCount)} detail="All unfinished tasks" />
        <SummaryStat label="Ready" value={String(readyCount)} detail="Eligible for a campaign" />
        <SummaryStat label="Blocked" value={String(blockedCount)} detail="Dependencies or gates unmet" />
        <SummaryStat label="Design gate" value={String(designGateCount)} detail="Approval required first" />
        <SummaryStat label="In campaign" value={String(claimedCount)} detail="Already claimed" />
      </div>
      <div className="workspace-toolbar">
        <input
          type="search"
          aria-label="Search tasks"
          placeholder="Search task ID or title…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {READINESS_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className="toolbar-chip"
            aria-pressed={readinessFilter === filter}
            onClick={() => setReadinessFilter(filter)}
          >
            {FILTER_LABEL[filter]}
          </button>
        ))}
        <span className="toolbar-note">View: Dependency frontier + list</span>
      </div>
      <div className="workspace-layout">
        <Panel
          title="Live dependency frontier"
          meta="Read-only projection · viewing changes no task state"
          flush
        >
          <div className="frontier-scroll">
            <div className="frontier-map">
              <FrontierColumn label="Foundations" tasks={foundations} />
              <div className="wave-arrow" aria-hidden="true">
                →
              </div>
              <FrontierColumn label="Next wave" tasks={nextWave} />
              <div className="wave-arrow" aria-hidden="true">
                →
              </div>
              <FrontierColumn label="Later" tasks={later} />
            </div>
          </div>
          <DataTable
            caption="Existing tasks"
            columns={columns}
            data={visibleTasks}
            emptyMessage={tasks.length === 0 ? "No existing tasks." : "No tasks match the current filter."}
            getRowId={(task) => task.id}
            {...(selectedTaskId ? { selectedRowId: selectedTaskId } : {})}
          />
        </Panel>
        <aside className="workspace-panel">
          <div className="workspace-inspector">
            {selectedTask ? (
              <TaskInspector task={selectedTask} />
            ) : (
              <>
                <span className="micro-label">Selected task</span>
                <p className="inspector-empty">
                  Select a task row to inspect its routing, dependencies, and source of truth.
                </p>
              </>
            )}
            {promptSet ? (
              <>
                <span className="detail-label">
                  {promptSet.context.taskId ? `Prompts · ${promptSet.context.taskId}` : "Prompts"}
                </span>
                <PromptActions promptSet={promptSet} />
              </>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  );
}
