import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_workbench/")({
  component: () => null,
});

// `/` is the workbench with nothing over it. The stage itself lives in the
// layout above (routes/_workbench.tsx) so that the run routes can cover it
// without unmounting a single pane, so this route's whole job is to render
// nothing — and it is deliberately the only route that does.
