import { createColumnHelper } from "@tanstack/react-table";
import type { Identity } from "../../../provenance/types.js";
import type { UiArtifactAction, UiArtifactAvailability, UiTaskHistoryV1 } from "../../read-models/task-history.js";
import { classifyUrl } from "../../security/url-policy.js";
import { DataTable } from "../components/data-table.js";
import { StatusBadge, type StatusTone } from "../components/status-badge.js";

type ArtifactRef = UiTaskHistoryV1["iterations"][number]["artifactRefs"][number];
type HistoryRow = { rowId: string; iterationId: string; outcome: string; artifactRef: ArtifactRef };

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
  if (identities.length === 0) return <span>No recorded identities</span>;
  return (
    <ul>
      {identities.map((identity) => (
        <li key={`${identity.label}-${identity.evidence}-${identity.verified}`}>
          <span>{identity.label}</span>{" "}
          <StatusBadge label={EVIDENCE_LABEL[identity.evidence]} tone={identity.verified ? "success" : "neutral"} />
        </li>
      ))}
    </ul>
  );
}

function ArtifactActions({ artifactRef }: { artifactRef: ArtifactRef }) {
  const availabilityBadge = (
    <StatusBadge
      label={AVAILABILITY_LABEL[artifactRef.availability]}
      tone={AVAILABILITY_TONE[artifactRef.availability]}
    />
  );
  if (artifactRef.availability !== "available") {
    return availabilityBadge;
  }
  const providerLink = artifactRef.url ? classifyUrl(artifactRef.url, NO_AUTHORITY) : null;
  return (
    <div>
      {availabilityBadge}
      <ul>
        {artifactRef.actions.map((action) => (
          <li key={action}>
            <a href={internalRoute(action, artifactRef)}>{ACTION_LABEL[action]}</a>
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
    </div>
  );
}

const columnHelper = createColumnHelper<HistoryRow>();

const columns = [
  columnHelper.accessor("iterationId", { header: "Iteration", cell: (info) => <span>{info.getValue()}</span> }),
  columnHelper.accessor("outcome", { header: "Outcome", cell: (info) => <span>{info.getValue()}</span> }),
  columnHelper.display({
    id: "path",
    header: "Path",
    cell: (info) => <span>{info.row.original.artifactRef.path}</span>,
  }),
  columnHelper.display({
    id: "commit",
    header: "Commit",
    cell: (info) => <span>{info.row.original.artifactRef.commit}</span>,
  }),
  columnHelper.display({
    id: "availability",
    header: "Availability & actions",
    cell: (info) => <ArtifactActions artifactRef={info.row.original.artifactRef} />,
  }),
  columnHelper.display({
    id: "identities",
    header: "Identities",
    cell: (info) => <IdentityList identities={info.row.original.artifactRef.identities} />,
  }),
];

export interface TaskHistoryViewProps {
  projection: UiTaskHistoryV1;
}

export function TaskHistoryView({ projection }: TaskHistoryViewProps) {
  const rows: HistoryRow[] = projection.iterations.flatMap((iteration) =>
    iteration.artifactRefs.map((artifactRef, index) => ({
      rowId: `${iteration.id}#${index}`,
      iterationId: iteration.id,
      outcome: iteration.outcome,
      artifactRef,
    })),
  );

  return (
    <section aria-labelledby="task-history-heading">
      <h1 id="task-history-heading">Task history: {projection.taskId}</h1>
      <DataTable
        caption={`History for ${projection.taskId}`}
        columns={columns}
        data={rows}
        emptyMessage="No recorded history."
        getRowId={(row) => row.rowId}
      />
    </section>
  );
}
