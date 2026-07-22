import { createColumnHelper } from "@tanstack/react-table";
import type { UiExistingTasksV1 } from "../../read-models/existing-tasks.js";
import type { UiPromptSetV1 } from "../../../prompt/types.js";
import { classifyUrl } from "../../security/url-policy.js";
import { DataTable } from "../components/data-table.js";
import { PromptActions } from "../components/prompt-actions.js";
import { StatusBadge, type StatusTone } from "../components/status-badge.js";
import { SyncBanner } from "../components/sync-banner.js";

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

const columnHelper = createColumnHelper<ExistingTask>();

const columns = [
  columnHelper.display({
    id: "task",
    header: "Task",
    cell: (info) => (
      <span>
        <strong>{info.row.original.id}</strong> {info.row.original.title}
      </span>
    ),
  }),
  columnHelper.display({
    id: "readiness",
    header: "Readiness",
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
      if (task.dependsOn.length === 0 && task.blockers.length === 0) return <span>None</span>;
      return (
        <div>
          {task.dependsOn.length > 0 ? <div>Depends on: {task.dependsOn.join(", ")}</div> : null}
          {task.blockers.length > 0 ? (
            <ul>
              {task.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    },
  }),
  columnHelper.display({
    id: "route",
    header: "Suggested route",
    cell: (info) => <span>{info.row.original.suggestedRoute.label}</span>,
  }),
  columnHelper.display({
    id: "source",
    header: "Source revision",
    cell: (info) => {
      const task = info.row.original;
      const classified = task.source.webUrl ? classifyUrl(task.source.webUrl, NO_AUTHORITY) : null;
      return (
        <div>
          <div>
            {task.source.driver}: {task.source.nativeId}
          </div>
          <div>Revision {task.nativeRevision}</div>
          {classified && classified.kind === "https" ? (
            <a href={classified.href} target="_blank" rel="noreferrer noopener">
              Open source
            </a>
          ) : null}
        </div>
      );
    },
  }),
  columnHelper.display({
    id: "coordination",
    header: "Coordination",
    cell: (info) => {
      const coordination = info.row.original.coordination;
      return (
        <span>
          {coordination ? `Claimed by ${coordination.owner} (${coordination.campaignId})` : "Unclaimed"}
        </span>
      );
    },
  }),
];

export interface ExistingTasksViewProps {
  projection: UiExistingTasksV1;
  /** State-valid copy actions for the selected task, when the server offers any. */
  promptSet?: UiPromptSetV1;
}

export function ExistingTasksView({ projection, promptSet }: ExistingTasksViewProps) {
  return (
    <section aria-labelledby="existing-tasks-heading">
      <h1 id="existing-tasks-heading">Existing tasks</h1>
      <SyncBanner
        pending={projection.source.pendingWrites}
        conflicts={projection.source.conflicts}
        syncHealth={projection.source.syncHealth}
        coordinationNotice={projection.coordinationNotice}
        leaseNotice={projection.leaseNotice}
        refreshedAt={projection.refreshedAt}
      />
      {promptSet ? (
        <>
          {promptSet.context.taskId ? <h2>Prompts for {promptSet.context.taskId}</h2> : <h2>Prompts</h2>}
          <PromptActions promptSet={promptSet} />
        </>
      ) : null}
      <DataTable
        caption="Existing tasks"
        columns={columns}
        data={projection.tasks}
        emptyMessage="No existing tasks."
        getRowId={(task) => task.id}
      />
    </section>
  );
}
