import { createFileRoute, Outlet } from "@tanstack/react-router";

import { RunsOverlay } from "~/components/runs-overlay";

export const Route = createFileRoute("/_workbench/runs")({
  component: RunsLayout,
});

/** The layer both run views share — chrome, Esc, and the way back out. */
function RunsLayout() {
  return (
    <RunsOverlay>
      <Outlet />
    </RunsOverlay>
  );
}
