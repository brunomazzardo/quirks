import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import type { CampaignStatus } from "../../../campaign/types.js";
import type { UiCampaignSummaryItem } from "../../ports/campaign-read.js";
import { DataTable } from "../components/data-table.js";
import { Panel } from "../components/panel.js";
import { StatusBadge, type StatusTone } from "../components/status-badge.js";
import { SummaryStat } from "../components/summary-stat.js";
import { WorkspaceHeader } from "../components/workspace-header.js";

export const STATE_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  preflight: "Preflight",
  awaiting_approval: "Awaiting approval",
  running: "Running",
  paused: "Paused",
  blocked: "Blocked",
  final_review: "Final review",
  landing: "Landing",
  hold: "Hold",
  complete: "Complete",
  cancelled: "Cancelled",
};

export const STATE_TONE: Record<CampaignStatus, StatusTone> = {
  draft: "neutral",
  preflight: "info",
  awaiting_approval: "warning",
  running: "info",
  paused: "warning",
  blocked: "danger",
  final_review: "info",
  landing: "info",
  hold: "warning",
  complete: "success",
  cancelled: "neutral",
};

/** States the v4 reference promotes above the history list. */
const LIVE_STATES: ReadonlySet<CampaignStatus> = new Set(["running", "paused", "awaiting_approval"]);

function currentRepositoryId(items: readonly UiCampaignSummaryItem[]): string | undefined {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.repositoryId, (counts.get(item.repositoryId) ?? 0) + 1);
  let best: string | undefined;
  let bestCount = 0;
  for (const [repositoryId, count] of counts) {
    if (count > bestCount) {
      best = repositoryId;
      bestCount = count;
    }
  }
  return best;
}

function timingLabel(item: UiCampaignSummaryItem): string {
  if (!item.startedAt) return "Not started";
  return item.finishedAt ? `${item.startedAt} – ${item.finishedAt}` : item.startedAt;
}

const columnHelper = createColumnHelper<UiCampaignSummaryItem>();

function buildColumns(onSelect: (campaignId: string) => void) {
  return [
    columnHelper.accessor("campaignId", {
      header: "Campaign",
      cell: (info) => (
        <span>
          <Link to="/campaigns/$campaignId" params={{ campaignId: info.getValue() }}>
            {info.getValue()}
          </Link>
          <span className="task-subtitle">{info.row.original.repositoryId}</span>
        </span>
      ),
    }),
    columnHelper.display({
      id: "state",
      header: "Status",
      cell: (info) => (
        <StatusBadge label={STATE_LABEL[info.row.original.state]} tone={STATE_TONE[info.row.original.state]} />
      ),
    }),
    columnHelper.accessor("taskCount", {
      header: "Tasks",
      cell: (info) => <span>{info.getValue()}</span>,
    }),
    columnHelper.display({
      id: "timing",
      header: "Timing",
      cell: (info) => <span>{timingLabel(info.row.original)}</span>,
    }),
    columnHelper.display({
      id: "outcome",
      header: "Outcome",
      cell: (info) => <span>{info.row.original.outcome ?? "Pending"}</span>,
    }),
    columnHelper.display({
      id: "inspect",
      header: "Details",
      cell: (info) => (
        <button type="button" className="toolbar-chip" onClick={() => onSelect(info.row.original.campaignId)}>
          Inspect
        </button>
      ),
    }),
  ];
}

function CampaignInspector({ item }: { item: UiCampaignSummaryItem }) {
  const spendEntries = item.spend ? Object.entries(item.spend) : [];
  return (
    <div className="workspace-inspector">
      <span className="micro-label">Selected campaign</span>
      <h2>{item.campaignId}</h2>
      <p>
        <StatusBadge label={STATE_LABEL[item.state]} tone={STATE_TONE[item.state]} />
      </p>
      <div className="score-row">
        <div className="score-cell">
          <span>Tasks</span>
          <strong>{item.taskCount}</strong>
        </div>
        <div className="score-cell">
          <span>Repository</span>
          <strong>{item.repositoryId}</strong>
        </div>
        <div className="score-cell">
          <span>Outcome</span>
          <strong>{item.outcome ?? "Pending"}</strong>
        </div>
      </div>
      <span className="detail-label">Timing</span>
      <p>{timingLabel(item)}</p>
      {spendEntries.length > 0 ? (
        <>
          <span className="detail-label">Recorded spend</span>
          {spendEntries.map(([pool, amount]) => (
            <p key={pool}>{`${pool}: ${amount}`}</p>
          ))}
        </>
      ) : null}
      <p>
        <Link to="/campaigns/$campaignId" params={{ campaignId: item.campaignId }}>
          Open campaign
        </Link>
      </p>
      <div className="safety-note">
        A past campaign is immutable. “Run again” creates a fresh preflight against current task
        revisions, runner health, target branch, and a new approval digest.
      </div>
    </div>
  );
}

export interface CampaignsViewProps {
  items: readonly UiCampaignSummaryItem[];
}

export function CampaignsView({ items }: CampaignsViewProps) {
  const defaultRepositoryId = useMemo(() => currentRepositoryId(items), [items]);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const columns = useMemo(() => buildColumns(setSelectedCampaignId), []);

  const visibleItems =
    showAllProjects || defaultRepositoryId === undefined
      ? items
      : items.filter((item) => item.repositoryId === defaultRepositoryId);

  const promoted = visibleItems.find((item) => LIVE_STATES.has(item.state)) ?? null;
  const historyItems = promoted
    ? visibleItems.filter((item) => item.campaignId !== promoted.campaignId)
    : visibleItems;

  const selected =
    (selectedCampaignId ? visibleItems.find((item) => item.campaignId === selectedCampaignId) : undefined) ??
    historyItems[0] ??
    promoted ??
    null;

  const activeCount = visibleItems.filter((item) => item.state === "running").length;
  const pausedCount = visibleItems.filter((item) => item.state === "paused").length;
  const completedCount = visibleItems.filter((item) => item.state === "complete").length;
  const heldCount = visibleItems.filter((item) => item.state === "hold").length;

  return (
    <section aria-labelledby="campaigns-heading">
      <WorkspaceHeader
        eyebrow="LOCAL QUIRKS JOURNAL"
        title="Campaigns"
        headingId="campaigns-heading"
        description="Campaign history is a local read model; the journal stays authoritative."
        actions={
          <label className="toolbar-chip">
            <input
              type="checkbox"
              checked={showAllProjects}
              onChange={(event) => setShowAllProjects(event.target.checked)}
            />{" "}
            Show all projects
          </label>
        }
      />
      <div className="summary-grid">
        <SummaryStat label="Active" value={String(activeCount)} detail="Currently running" />
        <SummaryStat label="Paused" value={String(pausedCount)} detail="Waiting to resume" />
        <SummaryStat label="Completed" value={String(completedCount)} detail="Finished campaigns" />
        <SummaryStat label="Held" value={String(heldCount)} detail="Operator decision needed" />
        <SummaryStat label="Recorded" value={String(visibleItems.length)} detail="All campaigns in scope" />
      </div>
      <div className="workspace-layout">
        <Panel
          title="Campaign history"
          meta={showAllProjects ? "All projects" : "Current repository"}
          flush
        >
          {promoted ? (
            <div className="active-campaign">
              <div>
                <StatusBadge label={STATE_LABEL[promoted.state]} tone={STATE_TONE[promoted.state]} />
                <h3>{promoted.campaignId}</h3>
                <p>{`${promoted.taskCount} tasks · ${promoted.repositoryId} · ${timingLabel(promoted)}`}</p>
              </div>
              <Link to="/campaigns/$campaignId" params={{ campaignId: promoted.campaignId }}>
                Open live campaign
              </Link>
            </div>
          ) : null}
          <DataTable
            caption="Campaigns"
            columns={columns}
            data={historyItems}
            emptyMessage="No campaigns yet."
            getRowId={(item) => item.campaignId}
            {...(selected ? { selectedRowId: selected.campaignId } : {})}
          />
        </Panel>
        <aside className="workspace-panel">
          {selected ? (
            <CampaignInspector item={selected} />
          ) : (
            <div className="workspace-inspector">
              <span className="micro-label">Selected campaign</span>
              <p className="inspector-empty">No campaigns yet — approved campaigns appear here.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
