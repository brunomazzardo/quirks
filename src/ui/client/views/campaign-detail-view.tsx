import { Link } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import type { UiCampaignCommit, UiCampaignDetail, UiCampaignPullRequest, UiCampaignRunner, UiCampaignTask, UiCampaignVerification, UiPlanProgressV1 } from "../../ports/campaign-read.js";
import { PlanProgressLedger, PlanProgressUnavailable } from "../components/plan-progress-ledger.js";
import { classifyUrl } from "../../security/url-policy.js";
import type { UiPromptSetV1 } from "../../../prompt/types.js";
import { DataTable } from "../components/data-table.js";
import { Panel } from "../components/panel.js";
import { PromptActions } from "../components/prompt-actions.js";
import { StatusBadge, type StatusTone } from "../components/status-badge.js";
import { SummaryStat } from "../components/summary-stat.js";
import { SyncBanner } from "../components/sync-banner.js";
import { WorkspaceHeader } from "../components/workspace-header.js";
import { STATE_LABEL, STATE_TONE } from "./campaigns-view.js";

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
      <Link to="/tasks/$taskId/history" params={{ taskId: info.getValue() }}>
        {info.getValue()}
      </Link>
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

function timingValue(detail: UiCampaignDetail): { value: string; detail?: string } {
  if (!detail.startedAt) return { value: "Not started" };
  return detail.finishedAt
    ? { value: detail.startedAt, detail: `Finished ${detail.finishedAt}` }
    : { value: detail.startedAt, detail: "In progress" };
}

export interface CampaignDetailViewProps {
  detail: UiCampaignDetail;
  planProgress?: UiPlanProgressV1;
  planProgressPending?: boolean;
  planProgressUnavailable?: boolean;
  promptSet?: UiPromptSetV1;
}

/**
 * Campaign detail has no governing wireframe (handoff §6.B); it reuses the
 * shared shell, summary, panel, table, and progress-ledger primitives, with
 * the v4 wave-step grammar for the wave rail and the v4 immutability framing
 * around "Run again".
 */
export function CampaignDetailView({
  detail,
  planProgress,
  planProgressPending,
  planProgressUnavailable,
  promptSet,
}: CampaignDetailViewProps) {
  const timing = timingValue(detail);
  return (
    <section aria-labelledby="campaign-detail-heading">
      <WorkspaceHeader
        eyebrow="CAMPAIGN"
        title={`Campaign ${detail.campaignId}`}
        headingId="campaign-detail-heading"
        description={`Repository ${detail.repositoryId}`}
        badges={[{ label: STATE_LABEL[detail.state], tone: STATE_TONE[detail.state] }]}
        {...(promptSet ? { actions: <PromptActions promptSet={promptSet} /> } : {})}
      />
      <SyncBanner pending={detail.sync.pending} conflicts={detail.sync.conflicts} />
      <div className="summary-grid" data-columns="4">
        <SummaryStat label="Tasks" value={String(detail.taskCount)} detail="In this campaign" />
        <SummaryStat label="State" value={STATE_LABEL[detail.state]} detail="Journal-reported" />
        <SummaryStat label="Timing" value={timing.value} {...(timing.detail ? { detail: timing.detail } : {})} />
        <SummaryStat label="Outcome" value={detail.outcome ?? "Pending"} />
      </div>
      <div className="workspace-notice">
        <div>
          <strong>A past campaign is immutable.</strong>
          <span>
            “Run again” creates a fresh preflight against current task revisions, runner health,
            target branch, and a new approval digest.
          </span>
        </div>
        <span className="workspace-notice-aside">
          <Link to="/">Run again</Link>
        </span>
      </div>
      {detail.reportPath ? <p className="cell-note">Report: {detail.reportPath}</p> : null}

      <div className="workspace-layout">
        <div className="workspace-stack">
          <Panel title="Tasks" meta="Task history is one click away" flush>
            <DataTable
              caption="Campaign tasks"
              columns={taskColumns}
              data={detail.tasks}
              emptyMessage="No tasks."
              getRowId={(task) => task.taskId}
            />
          </Panel>

          {planProgressPending ? <p role="status">Loading plan progress…</p> : null}
          {planProgress ? <PlanProgressLedger projection={planProgress} /> : null}
          {!planProgress && !planProgressPending && planProgressUnavailable ? <PlanProgressUnavailable /> : null}

          <Panel title="Commits" meta="Exact accepted references" flush>
            <DataTable
              caption="Commits"
              columns={commitColumns}
              data={detail.commits}
              emptyMessage="No commits."
              getRowId={(commit) => commit.sha}
            />
          </Panel>

          <Panel title="Pull requests" meta="Provider links validated" flush>
            <DataTable
              caption="Pull requests"
              columns={pullRequestColumns}
              data={detail.pullRequests}
              emptyMessage="No pull requests."
              getRowId={(pullRequest) => String(pullRequest.number)}
            />
          </Panel>

          <Panel title="Verification" meta="Recorded checks" flush>
            <DataTable
              caption="Verification"
              columns={verificationColumns}
              data={detail.verification}
              emptyMessage="No verification results."
              getRowId={(item, index) => `${item.label}-${index}`}
            />
          </Panel>
        </div>

        <aside className="workspace-stack workspace-rail">
          <Panel title="Waves" meta="Execution order">
            {detail.waves.length === 0 ? (
              <p>No waves.</p>
            ) : (
              <ul className="wave-steps">
                {detail.waves.map((wave) => (
                  <li key={wave.id}>
                    <i className="step-dot" aria-hidden="true" />
                    <span>{wave.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Runners" meta="Configured profiles" flush>
            <DataTable
              caption="Runners"
              columns={runnerColumns}
              data={detail.runners}
              emptyMessage="No runners."
              getRowId={(runner) => runner.id}
            />
          </Panel>
        </aside>
      </div>
    </section>
  );
}
