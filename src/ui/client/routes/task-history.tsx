import { useQuery } from "@tanstack/react-query";
import { useParams, useRouteContext } from "@tanstack/react-router";
import type { ApiClient } from "../api-client.js";
import { promptQueryOptions, taskHistoryQueryOptions } from "../query-options.js";
import type { RouterContext } from "../router.js";
import { TaskHistoryView } from "../views/task-history-view.js";

function TaskHistoryContent({ apiClient, taskId }: { apiClient: ApiClient; taskId: string }) {
  const query = useQuery(taskHistoryQueryOptions(apiClient, taskId));
  const promptQuery = useQuery({
    ...promptQueryOptions(apiClient, { contextKind: "review", taskId }),
    retry: false,
  });

  if (query.isPending) return <p role="status">Loading task history…</p>;
  if (query.isError) return <p role="alert">Unable to load task history.</p>;

  return (
    <TaskHistoryView
      projection={query.data}
      {...(promptQuery.data ? { promptSet: promptQuery.data } : {})}
    />
  );
}

export function TaskHistoryRoute() {
  const { taskId } = useParams({ strict: false }) as { taskId?: string };
  const { apiClient } = useRouteContext({ strict: false }) as RouterContext;

  if (!taskId) return <p role="alert">Unknown task.</p>;

  return <TaskHistoryContent apiClient={apiClient as ApiClient} taskId={taskId} />;
}
