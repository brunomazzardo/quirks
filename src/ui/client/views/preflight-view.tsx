import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api-client.js";
import { ApprovalForm } from "../components/approval-form.js";
import { isAuthHttpError } from "../http-errors.js";
import { queryClient as sharedQueryClient } from "../query-client.js";
import { preflightQueryOptions, promptQueryOptions, queryKeys } from "../query-options.js";
import { useTokenVault } from "../app.js";
import type { UiPreflightProposalV1 } from "../../types/preflight-proposal.js";
import type { UiPromptSetV1 } from "../../../prompt/types.js";
import { Panel } from "../components/panel.js";
import { PromptActions } from "../components/prompt-actions.js";
import { StatusBadge } from "../components/status-badge.js";
import { SummaryStat } from "../components/summary-stat.js";
import { WorkspaceHeader } from "../components/workspace-header.js";
import { confidenceBadge, routeTierLabel } from "../visual-states.js";

type RouterRuntime = {
  queryClient: typeof sharedQueryClient;
  apiClient: ApiClient;
};

type PreflightTask = UiPreflightProposalV1["tasks"][number];

/** v3 map density guard: the map is an overview; the complete list is exhaustive. */
const MAX_MAP_CARDS_PER_WAVE = 12;

function ListItems({ items, emptyLabel }: { items: readonly string[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p>{emptyLabel}</p>;
  }
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return `${minutes} min wall clock`;
}

/** Agent identity tint from the routed profile (approved identity colors). */
function agentCardClass(profileId: string): string {
  const normalized = profileId.toLowerCase();
  if (normalized.includes("claude")) return "task-card task-card--claude";
  if (normalized.includes("codex")) return "task-card task-card--codex";
  if (normalized.includes("cursor")) return "task-card task-card--cursor";
  return "task-card";
}

/**
 * v3 "Dependency and execution map": one column per wave, left → right is
 * execution order, agent-tinted cards. Task titles stay exclusive to the
 * complete task list below.
 */
function ExecutionMap({ proposal }: { proposal: UiPreflightProposalV1 }) {
  const tasksById = useMemo(
    () => new Map(proposal.tasks.map((task) => [task.taskId, task])),
    [proposal.tasks],
  );
  return (
    <Panel title="Dependency and execution map" meta="Left → right is execution order" flush>
      <div className="wave-map-scroll">
        <div className="wave-map">
          {proposal.waves.map((wave, index) => {
            const waveTasks = wave.taskIds
              .map((taskId) => tasksById.get(taskId))
              .filter((task): task is PreflightTask => task !== undefined);
            const visible = waveTasks.slice(0, MAX_MAP_CARDS_PER_WAVE);
            return (
              <div key={wave.id} className="wave-col-group">
                {index > 0 ? (
                  <span className="wave-arrow" aria-hidden="true">
                    →
                  </span>
                ) : null}
                <div className="wave-col">
                  <div className="wave-col-label">{wave.label}</div>
                  {visible.map((task) => {
                    const lane = proposal.lanes.find((entry) => entry.id === task.laneId);
                    return (
                      <div key={task.taskId} className={agentCardClass(task.route.profileId)}>
                        <div className="task-card-id">
                          {lane && proposal.lanes.length > 1 ? `${task.taskId} · ${lane.label}` : task.taskId}
                        </div>
                        <div className="task-card-owner">{task.route.profileId}</div>
                        <div className="task-card-score">
                          {`${routeTierLabel(task.route.tier)} / ${task.route.effort} · ${task.confidence} confidence`}
                        </div>
                      </div>
                    );
                  })}
                  {waveTasks.length > visible.length ? (
                    <p className="cell-note">{`+${waveTasks.length - visible.length} more in the complete task list`}</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="wave-legend">
        <span>
          <i className="legend-dot legend-dot--claude" aria-hidden="true" />
          Claude
        </span>
        <span>
          <i className="legend-dot legend-dot--codex" aria-hidden="true" />
          Codex
        </span>
        <span>
          <i className="legend-dot legend-dot--cursor" aria-hidden="true" />
          Cursor
        </span>
        <span>Tier / effort · planning confidence</span>
      </div>
    </Panel>
  );
}

function TaskTable({ proposal, filter }: { proposal: UiPreflightProposalV1; filter: string }) {
  const normalizedFilter = filter.trim().toLowerCase();
  const tasks = useMemo(() => {
    const ordered = [...proposal.tasks].toSorted((left, right) => {
      const leftWave = proposal.waves.findIndex((wave) => wave.id === left.waveId);
      const rightWave = proposal.waves.findIndex((wave) => wave.id === right.waveId);
      if (leftWave !== rightWave) return leftWave - rightWave;
      return left.taskId.localeCompare(right.taskId);
    });
    if (!normalizedFilter) return ordered;
    return ordered.filter((task) => {
      const haystack = `${task.taskId} ${task.title} ${task.waveId} ${task.laneId}`.toLowerCase();
      return haystack.includes(normalizedFilter);
    });
  }, [normalizedFilter, proposal.tasks, proposal.waves]);

  if (tasks.length === 0) {
    return <p className="data-table-empty">No tasks match the current filter.</p>;
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th scope="col">Task</th>
          <th scope="col">Wave</th>
          <th scope="col">Lane</th>
          <th scope="col">Route</th>
          <th scope="col">Fallback</th>
          <th scope="col">Confidence</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => {
          const wave = proposal.waves.find((entry) => entry.id === task.waveId);
          const lane = proposal.lanes.find((entry) => entry.id === task.laneId);
          const confidence = confidenceBadge(task.confidence);
          return (
            <tr key={task.taskId}>
              <td>
                <span>{task.taskId}</span> — {task.title}
              </td>
              <td>{wave?.label ?? task.waveId}</td>
              <td>{lane?.label ?? task.laneId}</td>
              <td>
                {task.route.profileId} ({routeTierLabel(task.route.tier)}, {task.route.effort})
              </td>
              <td>
                {task.fallback
                  ? `${task.fallback.profileId} (${routeTierLabel(task.fallback.tier)}, ${task.fallback.effort})`
                  : "None"}
              </td>
              <td>
                <StatusBadge label={confidence.label} tone={confidence.tone} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The complete list owns its filter state so keystrokes re-render only this
 * panel — the execution map and inspector stay static (Task-18 budget).
 */
function TaskListPanel({ proposal }: { proposal: UiPreflightProposalV1 }) {
  const [taskFilter, setTaskFilter] = useState("");
  return (
    <Panel title="Complete task list" meta="Nothing hidden by the visual map" flush>
      <div className="workspace-toolbar workspace-toolbar--embedded">
        <label htmlFor="preflight-task-filter">Filter tasks</label>
        <input
          id="preflight-task-filter"
          type="search"
          value={taskFilter}
          onChange={(event) => setTaskFilter(event.target.value)}
          placeholder="Filter by task id, title, wave, or lane"
        />
      </div>
      <div className="data-table-wrapper">
        <TaskTable proposal={proposal} filter={taskFilter} />
      </div>
    </Panel>
  );
}

/**
 * v3 selected-task inspector aside: proposed owner with rationale, score
 * triplet, acceptance proof, verification tests, and fallback. Renders the
 * task id, never the title — the complete list is the single title authority.
 */
function InspectorAside({ proposal }: { proposal: UiPreflightProposalV1 }) {
  const inspector = proposal.inspector;
  return (
    <aside className="workspace-panel">
      <div className="workspace-inspector">
        {inspector ? (
          <InspectorContent proposal={proposal} inspector={inspector} />
        ) : (
          <>
            <span className="micro-label">Selected task</span>
            <p className="inspector-empty">No selected-task inspector is available for this proposal.</p>
          </>
        )}
      </div>
    </aside>
  );
}

function InspectorContent({
  proposal,
  inspector,
}: {
  proposal: UiPreflightProposalV1;
  inspector: NonNullable<UiPreflightProposalV1["inspector"]>;
}) {
  const task = proposal.tasks.find((entry) => entry.taskId === inspector.taskId);
  return (
    <>
      <span className="micro-label">{`SELECTED TASK · ${inspector.taskId}`}</span>
      <h2>{inspector.taskId}</h2>
      <span className="detail-label">Proposed owner</span>
      <div className="reason-box">
        {task ? <strong>{`${task.route.profileId} · ${routeTierLabel(task.route.tier)} tier`}</strong> : null}
        {inspector.routingRationale}
      </div>
      {task ? (
        <div className="score-row">
          <div className="score-cell">
            <span>Tier</span>
            <strong>{routeTierLabel(task.route.tier)}</strong>
          </div>
          <div className="score-cell">
            <span>Effort</span>
            <strong>{task.route.effort}</strong>
          </div>
          <div className="score-cell">
            <span>Confidence</span>
            <strong>{task.confidence}</strong>
          </div>
        </div>
      ) : null}
      <span className="detail-label">Acceptance proof</span>
      <p>{inspector.acceptanceProof}</p>
      <span className="detail-label">Verification tests</span>
      <ListItems items={inspector.tests} emptyLabel="No verification tests listed." />
      <span className="detail-label">Fallback</span>
      {task?.fallback ? (
        <p>
          <strong>{`${task.fallback.profileId} · ${routeTierLabel(task.fallback.tier)} tier`}</strong>
          {" — switching before launch produces a new proposal digest."}
        </p>
      ) : (
        <p>No fallback route proposed.</p>
      )}
    </>
  );
}

export function PreflightView({ campaignId }: { campaignId: string }) {
  const vault = useTokenVault();
  const { apiClient, queryClient } = useRouteContext({ strict: false }) as RouterRuntime;
  const [approvalSettled, setApprovalSettled] = useState(false);
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);

  const preflightQuery = useQuery(preflightQueryOptions(apiClient, campaignId));
  const promptQuery = useQuery({
    ...promptQueryOptions(apiClient, { contextKind: "campaign", campaignId }),
    retry: false,
  });

  useEffect(() => {
    const handleClose = () => vault.clearAll();
    window.addEventListener("pagehide", handleClose);
    return () => window.removeEventListener("pagehide", handleClose);
  }, [vault]);

  useEffect(() => {
    if (preflightQuery.isError && isAuthHttpError(preflightQuery.error)) {
      vault.clearAll();
    }
  }, [preflightQuery.error, preflightQuery.isError, vault]);

  const approvalMutation = useMutation({
    mutationFn: async (input: { campaignId: string; envelopeDigest: string }) =>
      apiClient.submitApproval(input),
    retry: false,
    onSuccess: async (response) => {
      vault.clearApproval();
      setApprovalSettled(true);
      setApprovalMessage(formatApprovalResult(response.result, response.approvalEventId));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.preflight(campaignId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.campaignDetail(campaignId) }),
      ]);
    },
    onError: (error) => {
      if (isAuthHttpError(error)) {
        vault.clearAll();
      }
      setApprovalMessage(error instanceof Error ? error.message : "Approval request failed.");
    },
  });

  if (preflightQuery.isPending) {
    return <p role="status">Loading preflight proposal…</p>;
  }

  if (preflightQuery.isError) {
    return (
      <p role="alert">
        {preflightQuery.error instanceof Error
          ? preflightQuery.error.message
          : "Unable to load preflight proposal."}
      </p>
    );
  }

  const proposal = preflightQuery.data;
  const digestVisible =
    proposal.envelopeDigest.length > 0 &&
    proposal.approval.envelopeDigest === proposal.envelopeDigest &&
    proposal.approval.campaignId === proposal.campaignId;

  return (
    <PreflightProposalView
      proposal={proposal}
      approvalMessage={approvalMessage}
      approvalDisabled={approvalSettled || approvalMutation.isSuccess}
      approvalSubmitting={approvalMutation.isPending}
      digestVisible={digestVisible}
      {...(promptQuery.data ? { promptSet: promptQuery.data } : {})}
      onApprove={async () => {
        setApprovalMessage(null);
        await approvalMutation.mutateAsync({
          campaignId: proposal.approval.campaignId,
          envelopeDigest: proposal.approval.envelopeDigest,
        });
      }}
    />
  );
}

export function PreflightProposalView({
  proposal,
  approvalMessage = null,
  approvalDisabled = true,
  approvalSubmitting = false,
  digestVisible = proposal.envelopeDigest.length > 0 &&
    proposal.approval.envelopeDigest === proposal.envelopeDigest &&
    proposal.approval.campaignId === proposal.campaignId,
  promptSet,
  onApprove = async () => {},
}: {
  proposal: UiPreflightProposalV1;
  approvalMessage?: string | null;
  approvalDisabled?: boolean;
  approvalSubmitting?: boolean;
  digestVisible?: boolean;
  promptSet?: UiPromptSetV1;
  onApprove?: () => Promise<void>;
}) {
  const summaryConfidence = confidenceBadge(proposal.summary.confidence);
  const push = proposal.summary.push;

  return (
    <article className="preflight-view">
      <WorkspaceHeader
        eyebrow="PREFLIGHT · PROPOSAL ONLY"
        title={`Preflight proposal · ${proposal.campaignId}`}
        badges={[
          { label: "Awaiting approval", tone: "warning" },
          { label: summaryConfidence.label, tone: summaryConfidence.tone },
        ]}
        {...(promptSet ? { actions: <PromptActions promptSet={promptSet} /> } : {})}
      />

      <div className="workspace-notice workspace-notice--info">
        <div>
          <strong>Nothing has started.</strong>
          <span>
            This page is generated from the immutable candidate envelope. Changing anything produces
            a new digest.
          </span>
        </div>
        <span className="workspace-notice-aside">Envelope state: awaiting approval</span>
      </div>

      <section className="summary-grid" aria-label="Campaign summary">
        <SummaryStat
          label="Scope"
          value={`${proposal.summary.taskCount} exact tasks`}
          detail="No inferred backlog work"
        />
        <SummaryStat
          label="Execution"
          value={`${proposal.summary.waveCount} waves`}
          detail={`${proposal.lanes.length} agent ${proposal.lanes.length === 1 ? "lane" : "lanes"}`}
        />
        <SummaryStat
          label="Estimate"
          value={`${proposal.summary.estimatedMinutes} min`}
          detail={summaryConfidence.label}
        />
        <SummaryStat
          label="Budget"
          value={formatDuration(proposal.summary.budget.maxWallClockMs)}
          detail={`Max concurrency ${proposal.summary.budget.maxConcurrency}`}
        />
        <SummaryStat
          label="Landing"
          value={proposal.summary.landing.targetBranch}
          detail={push.enabled ? `Push to ${push.remote ?? "remote"}` : "Remote push disabled"}
        />
      </section>

      <div className="workspace-layout">
        <ExecutionMap proposal={proposal} />
        <InspectorAside proposal={proposal} />
      </div>

      <div className="panel-grid">
        <TaskListPanelWide proposal={proposal} />
        <Panel title="Where work lands" meta="Merge boundary">
          <p>
            <strong>Base commit:</strong> {proposal.summary.landing.baseCommit}
          </p>
          <p>
            <strong>Campaign branch:</strong> {proposal.summary.landing.campaignBranch}
          </p>
          <p>
            <strong>Target branch:</strong> {proposal.summary.landing.targetBranch}
          </p>
          <p>Campaign branch merges into target after verification.</p>
        </Panel>
        <Panel title="Push" meta={push.enabled ? "Enabled" : "Disabled"}>
          {push.enabled ? (
            <>
              <p>
                <strong>Remote:</strong> {push.remote ?? "Unavailable"}
              </p>
              <p>
                <strong>Branch:</strong> {push.branch ?? "Unavailable"}
              </p>
            </>
          ) : (
            <p>Push is disabled for this campaign envelope.</p>
          )}
        </Panel>
        <Panel title="Authority" meta="Local coordination only">
          <p>
            <strong>Human gates:</strong>
          </p>
          <ListItems items={proposal.humanGates} emptyLabel="No delegated human gates." />
          <p>
            <strong>Restricted capabilities:</strong>
          </p>
          <ListItems
            items={proposal.unsupportedCapabilities}
            emptyLabel="No restricted capabilities are listed."
          />
          <p>Repository-bound local coordination only. No shared lease is implied.</p>
        </Panel>
        <Panel title="Models and spend" meta="Proposed lanes">
          <p>
            <strong>Budget:</strong> {formatDuration(proposal.summary.budget.maxWallClockMs)}
          </p>
          <p>
            <strong>Concurrency:</strong> {String(proposal.summary.budget.maxConcurrency)}
          </p>
          <ul>
            {proposal.lanes.map((lane) => (
              <li key={lane.id}>
                {lane.label}: runner {lane.runner}, model {lane.model}, tasks {lane.taskIds.join(", ")}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Stop conditions and residuals" meta="Known before launch">
          <p>
            <strong>Residuals:</strong>
          </p>
          <ListItems items={proposal.residuals} emptyLabel="No residuals listed." />
        </Panel>
      </div>

      <footer className="approval-footer">
        <div className="approval-footer-inner">
          <div className="approval-digest">
            <span className="micro-label">Approval binds this exact campaign envelope</span>
            <span id="envelope-digest" className="digest-code">
              {`Campaign ${proposal.approval.campaignId} · ${proposal.approval.envelopeDigest}`}
            </span>
            <p role="status">
              Approval is bound to the displayed campaign ID and envelope digest. Envelope fields
              are read-only.
            </p>
          </div>
          <div className="approval-actions">
            {approvalMessage ? (
              <p role="status" className="approval-message">
                {approvalMessage}
              </p>
            ) : null}
            <ApprovalForm
              digestVisible={digestVisible}
              disabled={approvalDisabled}
              isSubmitting={approvalSubmitting}
              onApprove={onApprove}
            />
          </div>
        </div>
      </footer>
    </article>
  );
}

/** Full-width slot in the panel grid for the complete task list. */
function TaskListPanelWide({ proposal }: { proposal: UiPreflightProposalV1 }) {
  return (
    <div className="panel-grid-wide">
      <TaskListPanel proposal={proposal} />
    </div>
  );
}

function formatApprovalResult(
  result: "approved" | "rejected" | "stale" | "expired" | "replay" | "invalid",
  approvalEventId?: string,
): string {
  switch (result) {
    case "approved":
      return approvalEventId
        ? `Campaign approved. Event ${approvalEventId}.`
        : "Campaign approved.";
    case "rejected":
      return "Approval rejected.";
    case "stale":
      return "Approval digest is stale. Refresh the proposal and review the new digest.";
    case "expired":
      return "Approval token expired. Re-open the workspace with a fresh approval token.";
    case "replay":
      return "Approval token was already consumed.";
    case "invalid":
      return "Approval request was invalid.";
  }
}
