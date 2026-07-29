import { createFileRoute } from "@tanstack/react-router";

import { RunReport } from "~/components/run-report";

export const Route = createFileRoute("/_workbench/runs/$runId")({
  component: RunDetail,
});

/**
 * `$runId` is whatever `GET /v1/runs/:id` accepts, which is a run id OR its
 * slug (ops/Runs.ts `getRun`). The list links by slug because that is what a
 * person recognises and what `quirks report <slug>` takes, and the param is
 * passed through untouched rather than parsed here.
 */
function RunDetail() {
  const { runId } = Route.useParams();
  return <RunReport runId={runId} />;
}
