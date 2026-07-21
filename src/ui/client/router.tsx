import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  type RouterHistory,
} from "@tanstack/react-router";
import { RootRoute } from "./routes/root.js";
import { ExistingTasksRoute } from "./routes/existing-tasks.js";
import { PreflightRoute } from "./routes/preflight.js";
import { CampaignsRoute } from "./routes/campaigns.js";
import { CampaignDetailRoute } from "./routes/campaign-detail.js";
import { TaskHistoryRoute } from "./routes/task-history.js";

export interface RouterContext {
  queryClient: unknown;
  apiClient: unknown;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function assertId(value: string): string {
  if (!ID_PATTERN.test(value)) throw notFound();
  return value;
}

function NotFoundView() {
  return <p role="alert">Not found.</p>;
}

function PendingView() {
  return <p role="status">Loading…</p>;
}

function ErrorView() {
  return <p role="alert">Something went wrong.</p>;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootRoute,
  notFoundComponent: NotFoundView,
  pendingComponent: PendingView,
  errorComponent: ErrorView,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ExistingTasksRoute,
});

const preflightRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/preflight/$campaignId",
  params: {
    parse: ({ campaignId }) => ({ campaignId: assertId(campaignId) }),
  },
  component: PreflightRoute,
});

const campaignsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/campaigns",
  component: CampaignsRoute,
});

const campaignDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/campaigns/$campaignId",
  params: {
    parse: ({ campaignId }) => ({ campaignId: assertId(campaignId) }),
  },
  component: CampaignDetailRoute,
});

const taskHistoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/$taskId/history",
  params: {
    parse: ({ taskId }) => ({ taskId: assertId(taskId) }),
  },
  component: TaskHistoryRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  preflightRoute,
  campaignsRoute,
  campaignDetailRoute,
  taskHistoryRoute,
]);

export function createAppRouter(options: { context: RouterContext; history?: RouterHistory }) {
  const { context, history } = options;
  return createRouter({
    routeTree,
    context,
    defaultPreload: false,
    defaultNotFoundComponent: NotFoundView,
    defaultPendingComponent: PendingView,
    defaultErrorComponent: ErrorView,
    ...(history ? { history } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
