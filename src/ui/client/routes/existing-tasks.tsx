import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import type { ApiClient } from "../api-client.js";
import { existingTasksQueryOptions, promptQueryOptions } from "../query-options.js";
import type { RouterContext } from "../router.js";
import { ExistingTasksView } from "../views/existing-tasks-view.js";

const ACTIONABLE_STATUSES = ["blocked", "claimed", "ready"] as const;

export function ExistingTasksRoute() {
  const { apiClient } = useRouteContext({ strict: false }) as RouterContext;
  const query = useQuery(existingTasksQueryOptions(apiClient as ApiClient));
  const actionableTaskId = ACTIONABLE_STATUSES
    .flatMap((status) => query.data?.tasks.filter((task) => task.status === status) ?? [])
    .map((task) => task.id)[0];
  const promptQuery = useQuery({
    ...promptQueryOptions(apiClient as ApiClient, { contextKind: "task", taskId: actionableTaskId ?? "" }),
    enabled: Boolean(actionableTaskId),
    retry: false,
  });

  if (query.isPending) return <p role="status">Loading existing tasks…</p>;
  if (query.isError) return <p role="alert">Unable to load existing tasks.</p>;

  return (
    <ExistingTasksView
      projection={query.data}
      {...(promptQuery.data ? { promptSet: promptQuery.data } : {})}
    />
  );
}
