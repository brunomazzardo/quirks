import { createColumnHelper } from "@tanstack/react-table";
import type {
  UiCampaignCommit,
  UiCampaignDetail,
  UiCampaignPullRequest,
  UiCampaignRunner,
  UiCampaignTask,
  UiCampaignVerification,
} from "../../ports/campaign-read.js";
import { classifyUrl } from "../../security/url-policy.js";
import { DataTable } from "../components/data-table.js";
import { StatusBadge, type StatusTone } from "../components/status-badge.js";
import { SyncBanner } from "../components/sync-banner.js";

// classifyUrl only needs a real authority to validate loopback-http links; pull request
// links here are either https or absent, so a placeholder authority never matters.
const NO_AUTHORITY = "";

const PULL_REQUEST_TONE: Record<UiCampaignPullRequest["state"], StatusTone> = {
  open: "info",
  draft: "neutral",
  merged: "success",
  closed: "danger",
};

const taskColumnHelper = createColumnHelper<UiCampaignTask>();
const taskColumns = [
  taskColumnHelper.accessor("taskId", {
    header: "Task",
    cell: (info) => (
      <a href={`/tasks/${encodeURIComponent(info.getValue())}/history`}>
        {info.getValue()}
      </a>
    ),
  }),
  taskColumnHelper.accessor("title", { header: "Title", cell: (info) => <span>{info.getValue()}</span> }),
  taskColumnHelper.accessor("status", { header: "Status", cell: (info) => <span>{info.getValue()}</span> }),
];

const runnerColumnHelper = createColumnHelper<UiCampaignRunner>();
const runnerColumns = [
  runnerColumnHelper.accessor("id", { header: "Runner", cell: (info) => <span>{info.getValue()}</span> }),
  runnerColumnHelper.accessor("kind", { header: "Kind", cell: (info) => <span>{info.getValue()}</span> }),
  runnerColumnHelper.accessor("model", { header: "Model", cell: (info) => <span>{info.getValue()}</span> }),
];

const commitColumnHelper = createColumnHelper<UiCampaignCommit>();
const commitColumns = [
  commitColumnHelper.accessor("sha", { header: "Commit", cell: (info) => <span>{info.getValue()}</span> }),
  commitColumnHelper.accessor("message", { header: "Message", cell: (info) => <span>{info.getValue()}</span> }),
];

const pullRequestColumnHelper = createColumnHelper<UiCampaignPullRequest>();
const pullRequestColumns = [
  pullRequestColumnHelper.accessor("number", { header: "PR", cell: (info) => <span>#{info.getValue()}</span> }),
  pullRequestColumnHelper.accessor("title", { header: "Title", cell: (info) => <span>{info.getValue()}</span> }),
  pullRequestColumnHelper.display({
    id: "state",
    header: "State",
    cell: (info) => (
      <StatusBadge label={info.row.original.state} tone={PULL_REQUEST_TONE[info.row.original.state]} />
    ),
  }),
  pullRequestColumnHelper.display({
    id: "link",
    header: "Link",
    cell: (info) => {
      const classified = classifyUrl(info.row.original.url, NO_AUTHORITY);
      if (classified.kind !== "https") return <span>Unavailable</span>;
      return (
        <a href={classified.href} target="_blank" rel="noreferrer noopener">
          Open pull request
        </a>
      );
    },
  }),
];

const verificationColumnHelper = createColumnHelper<UiCampaignVerification>();
const verificationColumns = [
  verificationColumnHelper.accessor("label", { header: "Check", cell: (info) => <span>{info.getValue()}</span> }),
  verificationColumnHelper.accessor("outcome", { header: "Outcome", cell: (info) => <span>{info.getValue()}</span> }),
];

export interface CampaignDetailViewProps {
  detail: UiCampaignDetail;
}

export function CampaignDetailView({ detail }: CampaignDetailViewProps) {
  return (
    <section aria-labelledby="campaign-detail-heading">
      <h1 id="campaign-detail-heading">Campaign {detail.campaignId}</h1>
      <p>
        Repository {detail.repositoryId} — state {detail.state} — {detail.taskCount} tasks
        {detail.outcome ? ` — outcome ${detail.outcome}` : ""}
      </p>
      <SyncBanner pending={detail.sync.pending} conflicts={detail.sync.conflicts} />
      <p>
        <a href="/">Run again</a>
      </p>
      {detail.reportPath ? <p>Report: {detail.reportPath}</p> : null}

      <h2>Tasks</h2>
      <DataTable
        caption="Campaign tasks"
        columns={taskColumns}
        data={detail.tasks}
        emptyMessage="No tasks."
        getRowId={(task) => task.taskId}
      />

      <h2>Waves</h2>
      {detail.waves.length === 0 ? (
        <p>No waves.</p>
      ) : (
        <ul>
          {detail.waves.map((wave) => (
            <li key={wave.id}>{wave.label}</li>
          ))}
        </ul>
      )}

      <h2>Runners</h2>
      <DataTable
        caption="Runners"
        columns={runnerColumns}
        data={detail.runners}
        emptyMessage="No runners."
        getRowId={(runner) => runner.id}
      />

      <h2>Commits</h2>
      <DataTable
        caption="Commits"
        columns={commitColumns}
        data={detail.commits}
        emptyMessage="No commits."
        getRowId={(commit) => commit.sha}
      />

      <h2>Pull requests</h2>
      <DataTable
        caption="Pull requests"
        columns={pullRequestColumns}
        data={detail.pullRequests}
        emptyMessage="No pull requests."
        getRowId={(pullRequest) => String(pullRequest.number)}
      />

      <h2>Verification</h2>
      <DataTable
        caption="Verification"
        columns={verificationColumns}
        data={detail.verification}
        emptyMessage="No verification results."
        getRowId={(item, index) => `${item.label}-${index}`}
      />
    </section>
  );
}
