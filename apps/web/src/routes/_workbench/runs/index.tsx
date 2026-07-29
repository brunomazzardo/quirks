import { createFileRoute } from "@tanstack/react-router";

import { RunList } from "~/components/run-list";

export const Route = createFileRoute("/_workbench/runs/")({
  component: RunList,
});
