import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import type { CampaignStatus } from "../../../campaign/types.js";
import type { UiCampaignSummaryItem } from "../../ports/campaign-read.js";
import { DataTable } from "../components/data-table.js";
import { StatusBadge, type StatusTone } from "../components/status-badge.js";

const STATE_LABEL: Record<CampaignStatus, string> = {
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

const STATE_TONE: Record<CampaignStatus, StatusTone> = {
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

const columnHelper = createColumnHelper<UiCampaignSummaryItem>();

const columns = [
  columnHelper.accessor("campaignId", {
    header: "Campaign",
    cell: (info) => (
      <Link to="/campaigns/$campaignId" params={{ campaignId: info.getValue() }}>
        {info.getValue()}
      </Link>
    ),
  }),
  columnHelper.accessor("repositoryId", {
    header: "Repository",
    cell: (info) => <span>{info.getValue()}</span>,
  }),
  columnHelper.display({
    id: "state",
    header: "State",
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
    cell: (info) => {
      const item = info.row.original;
      return (
        <span>
          {item.startedAt ?? "Not started"}
          {item.finishedAt ? ` – ${item.finishedAt}` : ""}
        </span>
      );
    },
  }),
  columnHelper.display({
    id: "outcome",
    header: "Outcome",
    cell: (info) => <span>{info.row.original.outcome ?? "Pending"}</span>,
  }),
];

export interface CampaignsViewProps {
  items: readonly UiCampaignSummaryItem[];
}

export function CampaignsView({ items }: CampaignsViewProps) {
  const defaultRepositoryId = useMemo(() => currentRepositoryId(items), [items]);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const visibleItems =
    showAllProjects || defaultRepositoryId === undefined
      ? items
      : items.filter((item) => item.repositoryId === defaultRepositoryId);

  return (
    <section aria-labelledby="campaigns-heading">
      <h1 id="campaigns-heading">Campaigns</h1>
      <label>
        <input
          type="checkbox"
          checked={showAllProjects}
          onChange={(event) => setShowAllProjects(event.target.checked)}
        />
        Show all projects
      </label>
      <DataTable
        caption="Campaigns"
        columns={columns}
        data={visibleItems}
        emptyMessage="No campaigns yet."
        getRowId={(item) => item.campaignId}
      />
    </section>
  );
}
