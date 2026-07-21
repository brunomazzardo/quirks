import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import type { ApiClient } from "../api-client.js";
import { existingTasksQueryOptions } from "../query-options.js";
import type { RouterContext } from "../router.js";
import { ExistingTasksView } from "../views/existing-tasks-view.js";

export function ExistingTasksRoute() {
  const { apiClient } = useRouteContext({ strict: false }) as RouterContext;
  const query = useQuery(existingTasksQueryOptions(apiClient as ApiClient));

  if (query.isPending) return <p role="status">Loading existing tasks…</p>;
  if (query.isError) return <p role="alert">Unable to load existing tasks.</p>;

  return <ExistingTasksView projection={query.data} />;
}
