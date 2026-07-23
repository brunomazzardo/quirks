import type { Identity } from "../../../provenance/types.js";
import type { UiArtifactAction, UiArtifactAvailability, UiArtifactKind, UiTaskHistoryV1 } from "../../read-models/task-history.js";
import type { UiPromptSetV1 } from "../../../prompt/types.js";
import { classifyUrl } from "../../security/url-policy.js";
import { Panel } from "../components/panel.js";
import { PromptActions } from "../components/prompt-actions.js";
import { StatusBadge, type StatusTone } from "../components/status-badge.js";
import { SummaryStat } from "../components/summary-stat.js";
import { WorkspaceHeader } from "../components/workspace-header.js";

type Iteration = UiTaskHistoryV1["iterations"][number];
type ArtifactRef = Iteration["artifactRefs"][number];

// classifyUrl only needs a real authority to validate loopback-http links; provider links here
// are either https or absent, so a placeholder authority never matters.
const NO_AUTHORITY = "";

const AVAILABILITY_LABEL: Record<UiArtifactAvailability, string> = {
  available: "Available",
  "missing-at-commit": "Missing at commit",
  unavailable: "Unavailable",
  "unsupported-scheme": "Unsupported link",
};

const AVAILABILITY_TONE: Record<UiArtifactAvailability, StatusTone> = {
  available: "success",
  "missing-at-commit": "warning",
  unavailable: "danger",
  "unsupported-scheme": "danger",
};

const EVIDENCE_LABEL: Record<Identity["evidence"], string> = {
  "configured-profile": "Configured profile",
  "authenticated-host": "Authenticated host",
  "authenticated-provider": "Authenticated provider",
  "self-asserted": "Self-asserted",
  "self-asserted-git-metadata": "Git metadata (self-asserted)",
  "git-signature": "Git signature",
};

const ACTION_LABEL: Record<UiArtifactAction, string> = {
  "open-as-executed": "Open as executed",
  "open-current": "Open current",
  compare: "Compare",
};

/** v5 typed file cards (SUPERPOWERS SPEC / IMPLEMENTATION PLAN / INDEPENDENT REVIEW). */
const KIND_LABEL: Record<UiArtifactKind, string> = {
  spec: "Superpowers spec",
  plan: "Implementation plan",
  review: "Independent review",
  other: "Artifact ref",
};

/** Kinds promoted into the v5 "Governing files" grouping. */
const GOVERNING_KINDS: readonly UiArtifactKind[] = ["spec", "plan", "review"];

/**
 * Governing refs across all iterations, deduped by kind, path, and exact
 * revision. Only refs whose provenance records a governing kind qualify —
 * absent kind data yields no governing panel.
 */
function collectGoverningRefs(iterations: readonly Iteration[]): ArtifactRef[] {
  const seen = new Set<string>();
  const refs: ArtifactRef[] = [];
  for (const iteration of iterations) {
    for (const artifactRef of iteration.artifactRefs) {
      if (artifactRef.kind === undefined || !GOVERNING_KINDS.includes(artifactRef.kind)) continue;
      const key = `${artifactRef.kind}:${artifactRef.path}@${artifactRef.commit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(artifactRef);
    }
  }
  return refs;
}

function internalRoute(action: UiArtifactAction, artifactRef: ArtifactRef): string {
  const params = new URLSearchParams({ path: artifactRef.path });
  if (action === "open-as-executed") {
    params.set("commit", artifactRef.commit);
    return `/git/open?${params.toString()}`;
  }
  if (action === "open-current") {
    return `/git/open?${params.toString()}`;
  }
  params.set("base", artifactRef.commit);
  params.set("head", "current");
  return `/git/compare?${params.toString()}`;
}

function IdentityList({ identities }: { identities: readonly Identity[] }) {
  if (identities.length === 0) return <p className="inspector-empty">No recorded identities</p>;
  return (
    <ul className="identity-list">
      {identities.map((identity) => (
        <li key={`${identity.label}-${identity.evidence}-${identity.verified}`}>
          <span>{identity.label}</span>
          <StatusBadge label={EVIDENCE_LABEL[identity.evidence]} tone={identity.verified ? "success" : "neutral"} />
        </li>
      ))}
    </ul>
  );
}

/**
 * v5 artifact card: typed kind chip (when provenance records one), monospace
 * path, executed-at revision, availability, and the exact internal Git actions
 * (plus a provider link when the URL is safe). Absent kind renders the generic
 * card.
 */
function ArtifactCard({ artifactRef }: { artifactRef: ArtifactRef }) {
  const providerLink = artifactRef.url ? classifyUrl(artifactRef.url, NO_AUTHORITY) : null;
  return (
    <li className="artifact-card">
      {artifactRef.kind !== undefined ? (
        <span className="micro-label artifact-kind" data-kind={artifactRef.kind}>
          {KIND_LABEL[artifactRef.kind]}
        </span>
      ) : (
        <span className="micro-label">Artifact ref</span>
      )}
      <div className="artifact-path">{artifactRef.path}</div>
      <div className="artifact-meta">{`Executed at ${artifactRef.commit}`}</div>
      <StatusBadge
        label={AVAILABILITY_LABEL[artifactRef.availability]}
        tone={AVAILABILITY_TONE[artifactRef.availability]}
      />
      {artifactRef.availability === "available" ? (
        <ul className="artifact-actions">
          {artifactRef.actions.map((action) => (
            <li key={action}>
              <a
                href={internalRoute(action, artifactRef)}
                className={action === "open-as-executed" ? "artifact-action--primary" : undefined}
              >
                {ACTION_LABEL[action]}
              </a>
            </li>
          ))}
          {providerLink && providerLink.kind === "https" ? (
            <li>
              <a href={providerLink.href} target="_blank" rel="noreferrer noopener">
                Open in provider
              </a>
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

/** v5 iteration card: append-only ordinal eyebrow, outcome, and governed artifacts. */
function IterationCard({ iteration, ordinal }: { iteration: Iteration; ordinal: number }) {
  return (
    <div className="iteration-card">
      <div className="iteration-top">
        <div>
          <span className="micro-label">{`Iteration ${ordinal}`}</span>
          <div className="iteration-outcome">{iteration.outcome}</div>
          <p className="cell-note">{`Journal id ${iteration.id}`}</p>
        </div>
      </div>
      {iteration.artifactRefs.length === 0 ? (
        <p className="cell-note">No artifact references recorded for this iteration.</p>
      ) : (
        <ul className="artifact-cards">
          {iteration.artifactRefs.map((artifactRef, index) => (
            <ArtifactCard key={`${artifactRef.path}#${index}`} artifactRef={artifactRef} />
          ))}
        </ul>
      )}
    </div>
  );
}

function identityKey(identity: Identity): string {
  return `${identity.label}-${identity.evidence}-${identity.verified}`;
}

function collectIdentities(iterations: readonly Iteration[]): Identity[] {
  const seen = new Set<string>();
  const identities: Identity[] = [];
  for (const iteration of iterations) {
    for (const artifactRef of iteration.artifactRefs) {
      for (const identity of artifactRef.identities) {
        const key = identityKey(identity);
        if (seen.has(key)) continue;
        seen.add(key);
        identities.push(identity);
      }
    }
  }
  return identities;
}

export interface TaskHistoryViewProps {
  projection: UiTaskHistoryV1;
  /** State-valid copy actions for this task, when the server offers any. */
  promptSet?: UiPromptSetV1;
}

export function TaskHistoryView({ projection, promptSet }: TaskHistoryViewProps) {
  const iterations = projection.iterations;
  const artifactCount = iterations.reduce((total, iteration) => total + iteration.artifactRefs.length, 0);
  const availableCount = iterations.reduce(
    (total, iteration) =>
      total + iteration.artifactRefs.filter((artifactRef) => artifactRef.availability === "available").length,
    0,
  );
  const identities = collectIdentities(iterations);
  const governingRefs = collectGoverningRefs(iterations);
  const latestOutcome = iterations.at(-1)?.outcome;

  return (
    <section aria-labelledby="task-history-heading">
      <p className="workspace-crumb">{`Existing tasks / ${projection.taskId} / History and provenance`}</p>
      <WorkspaceHeader
        title={`Task history · ${projection.taskId}`}
        headingId="task-history-heading"
        description="Reference-only provenance. Files, Git, and the campaign journal remain authoritative."
        badges={[
          { label: `${iterations.length} ${iterations.length === 1 ? "iteration" : "iterations"}`, tone: "neutral" },
          { label: `${artifactCount} artifact ${artifactCount === 1 ? "ref" : "refs"}`, tone: "neutral" },
        ]}
        {...(promptSet ? { actions: <PromptActions promptSet={promptSet} /> } : {})}
      />
      <div className="workspace-notice workspace-notice--warning">
        <div>
          <strong>Local coordination only.</strong>
          <span>
            Attribution is recorded, but version one does not prevent another user on a different
            machine from attempting the same task.
          </span>
        </div>
        <span className="workspace-notice-aside">No shared lease</span>
      </div>
      <div className="summary-grid" data-columns="4">
        <SummaryStat label="Iterations" value={String(iterations.length)} detail="Append-only summaries" />
        <SummaryStat label="Artifact refs" value={String(artifactCount)} detail="Exact historical revisions" />
        <SummaryStat
          label="Available"
          value={`${availableCount} / ${artifactCount}`}
          detail="Resolvable references"
        />
        {latestOutcome !== undefined ? (
          <SummaryStat label="Latest outcome" value={latestOutcome} detail="Journal-reported" />
        ) : (
          <SummaryStat label="Latest outcome" value="—" detail="No recorded iterations" />
        )}
      </div>
      <div className="workspace-layout">
        <div className="workspace-stack">
          {governingRefs.length > 0 ? (
            <Panel title="Governing files" meta="References only · exact historical revisions preserved" flush>
              <ul className="artifact-cards">
                {governingRefs.map((artifactRef) => (
                  <ArtifactCard
                    key={`${artifactRef.kind}-${artifactRef.path}#${artifactRef.commit}`}
                    artifactRef={artifactRef}
                  />
                ))}
              </ul>
            </Panel>
          ) : null}
          <Panel
            title="Iteration history"
            meta="Append-only summaries · detailed events remain in campaign journals"
            flush
          >
            {iterations.length === 0 ? (
              <p className="data-table-empty">No recorded history.</p>
            ) : (
              iterations.map((iteration, index) => (
                <IterationCard key={iteration.id} iteration={iteration} ordinal={index + 1} />
              ))
            )}
          </Panel>
        </div>
        <aside className="provenance-rail">
          <section className="workspace-panel rail-panel">
            <span className="micro-label">Attribution</span>
            <IdentityList identities={identities} />
            <div className="safety-note">
              Git author and committer names are self-asserted unless a valid signature or
              authenticated provider identity verifies them.
            </div>
          </section>
          <section className="workspace-panel rail-panel">
            <span className="micro-label">Reference coverage</span>
            <p>{`${availableCount} of ${artifactCount} artifact references resolve at their recorded revisions.`}</p>
            <p className="cell-note">
              Commit-derived counts only; nothing here is invented beyond the recorded references.
            </p>
          </section>
        </aside>
      </div>
    </section>
  );
}
