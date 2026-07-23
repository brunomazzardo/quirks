import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ApiClient } from "../api-client.js";
import { ApprovalForm } from "../components/approval-form.js";
import { isAuthHttpError } from "../http-errors.js";
import { queryClient as sharedQueryClient } from "../query-client.js";
import { preflightQueryOptions, promptQueryOptions, queryKeys } from "../query-options.js";
import { useTokenVault } from "../app.js";
import type { UiPreflightProposalV1 } from "../../types/preflight-proposal.js";
import type { UiPromptSetV1 } from "../../../prompt/types.js";
import { PromptActions } from "../components/prompt-actions.js";
import { confidenceBadge, routeTierLabel, type BadgeDescriptor } from "../visual-states.js";

type RouterRuntime = {
  queryClient: typeof sharedQueryClient;
  apiClient: ApiClient;
};

function StatusBadge({ label, tone }: BadgeDescriptor) {
  return (
    <span className="status-badge" data-tone={tone}>
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="preflight-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <strong>{label}:</strong> {value}
    </p>
  );
}

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

function TaskTable({
  proposal,
  filter,
}: {
  proposal: UiPreflightProposalV1;
  filter: string;
}) {
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
    return <p>No tasks match the current filter.</p>;
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
              <td>{wave?.label ?? task.waveId ?? "Unavailable"}</td>
              <td>{lane?.label ?? task.laneId ?? "Unavailable"}</td>
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

function InspectorPanel({ proposal }: { proposal: UiPreflightProposalV1 }) {
  const inspector = proposal.inspector;
  if (!inspector) {
    return <p>No selected-task inspector is available for this proposal.</p>;
  }
  return (
    <div>
      <ReadOnlyField label="Task" value={inspector.taskId} />
      <p>
        <strong>Routing rationale:</strong> {inspector.routingRationale}
      </p>
      <p>
        <strong>Acceptance proof:</strong> {inspector.acceptanceProof}
      </p>
      <p>
        <strong>Verification tests:</strong>
      </p>
      <ListItems items={inspector.tests} emptyLabel="No verification tests listed." />
    </div>
  );
}

export function PreflightView({ campaignId }: { campaignId: string }) {
  const vault = useTokenVault();
  const { apiClient, queryClient } = useRouteContext({ strict: false }) as RouterRuntime;
  const [approvalSettled, setApprovalSettled] = useState(false);
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);
  // Captured once at mount: read-only workspaces never receive an approval
  // credential, so the approval affordance is suppressed rather than rendered
  // as a dead form. Only the capability (a boolean) is captured — the
  // credential itself stays in the closure-backed vault.
  const [approvalCapable] = useState(() => vault.withApprovalToken(() => true) === true);

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
      approvalAvailable={approvalCapable}
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
  approvalAvailable = true,
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
  approvalAvailable?: boolean;
  approvalDisabled?: boolean;
  approvalSubmitting?: boolean;
  digestVisible?: boolean;
  promptSet?: UiPromptSetV1;
  onApprove?: () => Promise<void>;
}) {
  const [taskFilter, setTaskFilter] = useState("");
  const summaryConfidence = confidenceBadge(proposal.summary.confidence);

  return (
    <article className="preflight-view">
      <header>
        <h1>Preflight proposal</h1>
        <p>
          Campaign <strong>{proposal.campaignId}</strong> is awaiting approval.
        </p>
        <p>
          <StatusBadge label={summaryConfidence.label} tone={summaryConfidence.tone} />
        </p>
        {promptSet ? <PromptActions promptSet={promptSet} /> : null}
      </header>

      <Section title="What will run">
        <ReadOnlyField label="Tasks" value={String(proposal.summary.taskCount)} />
        <ReadOnlyField
          label="Waves"
          value={proposal.summary.waveCount === null ? "Unavailable" : String(proposal.summary.waveCount)}
        />
        <ReadOnlyField
          label="Estimated duration"
          value={
            proposal.summary.estimatedMinutes === null
              ? "Unavailable"
              : `${proposal.summary.estimatedMinutes} min`
          }
        />
        <p>
          <label htmlFor="preflight-task-filter">Filter tasks</label>
          <input
            id="preflight-task-filter"
            type="search"
            value={taskFilter}
            onChange={(event) => setTaskFilter(event.target.value)}
            placeholder="Filter by task id, title, wave, or lane"
          />
        </p>
        <div className="data-table-wrapper">
        <TaskTable proposal={proposal} filter={taskFilter} />
        </div>
        <p>
          <strong>Execution map:</strong>
        </p>
        {proposal.waves.length === 0 ? (
          <p>Wave assignments are not recorded in the durable campaign envelope.</p>
        ) : (
          <ul>
            {proposal.waves.map((wave) => (
              <li key={wave.id}>
                {wave.label}: {wave.taskIds.join(", ")}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Delegated judgment">
        <InspectorPanel proposal={proposal} />
        <p>
          <strong>Human gates:</strong>
        </p>
        <ListItems items={proposal.humanGates} emptyLabel="No delegated human gates." />
      </Section>

      <Section title="Where work lands">
        <ReadOnlyField label="Base commit" value={proposal.summary.landing.baseCommit} />
        <ReadOnlyField label="Campaign branch" value={proposal.summary.landing.campaignBranch} />
        <ReadOnlyField label="Target branch" value={proposal.summary.landing.targetBranch} />
        <ReadOnlyField label="Merge strategy" value="Campaign branch into target after verification" />
      </Section>

      <Section title="Push">
        <ReadOnlyField
          label="Push enabled"
          value={proposal.summary.push.enabled ? "Yes" : "No"}
        />
        {proposal.summary.push.enabled ? (
          <>
            <ReadOnlyField label="Remote" value={proposal.summary.push.remote ?? "Unavailable"} />
            <ReadOnlyField label="Branch" value={proposal.summary.push.branch ?? "Unavailable"} />
          </>
        ) : (
          <p>Push is disabled for this campaign envelope.</p>
        )}
      </Section>

      <Section title="Authority">
        <ListItems
          items={proposal.unsupportedCapabilities}
          emptyLabel="No restricted capabilities are listed."
        />
        <p>Repository-bound local coordination only. No shared lease is implied.</p>
      </Section>

      <Section title="Models and spend">
        <ReadOnlyField label="Budget" value={formatDuration(proposal.summary.budget.maxWallClockMs)} />
        <ReadOnlyField
          label="Concurrency"
          value={String(proposal.summary.budget.maxConcurrency)}
        />
        <p>
          <strong>Agent lanes:</strong>
        </p>
        {proposal.lanes.length === 0 ? (
          <p>Agent lane details are not recorded in the durable campaign envelope.</p>
        ) : (
          <ul>
            {proposal.lanes.map((lane) => (
              <li key={lane.id}>
                {lane.label}: runner {lane.runner}, model {lane.model}, tasks {lane.taskIds.join(", ")}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Verification">
        {proposal.inspector ? (
          <>
            <ReadOnlyField label="Task" value={proposal.inspector.taskId} />
            <p>
              <strong>Acceptance proof:</strong> {proposal.inspector.acceptanceProof}
            </p>
            <p>
              <strong>Verification tests:</strong>
            </p>
            <ListItems items={proposal.inspector.tests} emptyLabel="No verification tests listed." />
          </>
        ) : (
          <p>No verification gates are available for the selected task.</p>
        )}
      </Section>

      <Section title="Stop conditions and residuals">
        <p>
          <strong>Residuals:</strong>
        </p>
        <ListItems items={proposal.residuals} emptyLabel="No residuals listed." />
        <p>
          <strong>Unsupported capabilities:</strong>
        </p>
        <ListItems
          items={proposal.unsupportedCapabilities}
          emptyLabel="No unsupported capabilities listed."
        />
      </Section>

      <Section title="Approval digest binding">
        <ReadOnlyField label="Campaign ID" value={proposal.approval.campaignId} />
        <p id="envelope-digest">
          <strong>Envelope digest:</strong> {proposal.approval.envelopeDigest}
        </p>
        <p role="status">
          Approval is bound to the displayed campaign ID and envelope digest. Envelope fields are
          read-only.
        </p>
      </Section>

      <Section title="Approve">
        {approvalMessage ? <p role="status">{approvalMessage}</p> : null}
        {approvalAvailable ? (
          <ApprovalForm
            digestVisible={digestVisible}
            disabled={approvalDisabled}
            isSubmitting={approvalSubmitting}
            onApprove={onApprove}
          />
        ) : (
          <p>
            This workspace is read-only and holds no approval credential. To approve, open the
            campaign-bound workspace for this campaign.
          </p>
        )}
      </Section>
    </article>
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
