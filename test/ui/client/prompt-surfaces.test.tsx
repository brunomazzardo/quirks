import assert from "node:assert/strict";
import test from "node:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { CampaignDetailView } from "../../../src/ui/client/views/campaign-detail-view.js";
import { ExistingTasksView } from "../../../src/ui/client/views/existing-tasks-view.js";
import { TaskHistoryView } from "../../../src/ui/client/views/task-history-view.js";
import { buildPromptSet } from "../../../src/ui/read-models/prompts.js";
import type { UiCampaignDetail } from "../../../src/ui/ports/campaign-read.js";
import type { UiExistingTasksV1 } from "../../../src/ui/read-models/existing-tasks.js";
import type { UiTaskHistoryV1 } from "../../../src/ui/read-models/task-history.js";
import { approvedCampaignPromptContext, reviewPromptContext } from "../support/fake-prompts.js";

async function renderWithRouter(node: ReactNode): Promise<string> {
  const rootRoute = createRootRoute({ component: () => <>{node}</> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <>{node}</>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

function campaignDetail(): UiCampaignDetail {
  return {
    campaignId: "C-1",
    repositoryId: "repo-1",
    state: "awaiting_approval",
    taskCount: 1,
    tasks: [{ taskId: "QK-1", title: "Contract task", status: "ready" }],
    waves: [],
    runners: [],
    commits: [],
    pullRequests: [],
    verification: [],
    sync: { pending: 0, conflicts: 0 },
  };
}

function existingTasks(): UiExistingTasksV1 {
  return {
    schemaVersion: 1,
    refreshedAt: "2026-07-22T12:00:00.000Z",
    coordinationNotice: "Local coordination only",
    leaseNotice: "No shared lease",
    source: { driver: "json", protocol: "task-source-v1", pendingWrites: 0, conflicts: 0, syncHealth: "fresh" },
    tasks: [],
  };
}

function taskHistory(): UiTaskHistoryV1 {
  return {
    schemaVersion: 1,
    taskId: "QK-1",
    iterations: [],
  };
}

test("campaign detail exposes prompt actions when a prompt set is provided", async () => {
  const promptSet = buildPromptSet(approvedCampaignPromptContext());
  const html = await renderWithRouter(
    <CampaignDetailView detail={campaignDetail()} promptSet={promptSet} />,
  );
  assert.match(html, /Copy start campaign prompt/);
  assert.match(html, /More prompts/);
});

test("views render no misleading disabled prompt action when the server omits recipes", async () => {
  const html = await renderWithRouter(<CampaignDetailView detail={campaignDetail()} />);
  assert.doesNotMatch(html, /Copy .* prompt/);
  assert.doesNotMatch(html, /More prompts/);

  const tasksHtml = renderToStaticMarkup(<ExistingTasksView projection={existingTasks()} />);
  assert.doesNotMatch(tasksHtml, /More prompts/);

  const historyHtml = renderToStaticMarkup(<TaskHistoryView projection={taskHistory()} />);
  assert.doesNotMatch(historyHtml, /More prompts/);
});

test("task history exposes the review copy action for review-ready tasks", () => {
  const promptSet = buildPromptSet(reviewPromptContext());
  const html = renderToStaticMarkup(
    <TaskHistoryView projection={taskHistory()} promptSet={promptSet} />,
  );
  assert.match(html, /Copy review prompt/);
});

test("existing tasks expose state-aware prompt actions for the selected task", () => {
  const promptSet = buildPromptSet(reviewPromptContext({
    contextKind: "task",
    task: {
      id: "QK-9",
      title: "Blocked task",
      status: "blocked",
      dependsOn: [],
      nativeRevision: `sha256:${"d".repeat(64)}`,
      acceptanceCriteria: [],
      verification: [],
      blockedReason: "Dependency broke",
      unblockCondition: "Dependency fixed",
    },
  }));
  const html = renderToStaticMarkup(
    <ExistingTasksView projection={existingTasks()} promptSet={promptSet} />,
  );
  assert.match(html, /Copy unblock task prompt/);
});
