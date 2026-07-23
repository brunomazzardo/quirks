import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { CampaignDetailView } from "../../../src/ui/client/views/campaign-detail-view.js";
import { CampaignsView } from "../../../src/ui/client/views/campaigns-view.js";
import { ExistingTasksView } from "../../../src/ui/client/views/existing-tasks-view.js";
import { PreflightProposalView } from "../../../src/ui/client/views/preflight-view.js";
import { TaskHistoryView } from "../../../src/ui/client/views/task-history-view.js";
import type { UiCampaignDetail, UiCampaignSummaryItem } from "../../../src/ui/ports/campaign-read.js";
import type { UiExistingTasksV1 } from "../../../src/ui/read-models/existing-tasks.js";
import type { UiTaskHistoryV1 } from "../../../src/ui/read-models/task-history.js";
import type { UiPreflightProposalV1 } from "../../../src/ui/types/preflight-proposal.js";

async function renderWithRouter(node: ReactNode): Promise<string> {
  const rootRoute = createRootRoute({ component: () => createElement("div", null, node) });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => createElement("div", null, node),
  });
  const campaignDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/campaigns/$campaignId",
    component: () => null,
  });
  const taskHistoryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tasks/$taskId/history",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, campaignDetailRoute, taskHistoryRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function preflightProposal(): UiPreflightProposalV1 {
  return {
    schemaVersion: 1,
    campaignId: "C-1",
    state: "awaiting_approval",
    envelopeDigest: "sha256:preflight-digest",
    summary: {
      taskCount: 2,
      waveCount: 2,
      estimatedMinutes: 45,
      confidence: "medium",
      budget: { maxWallClockMs: 3_600_000, maxConcurrency: 2 },
      landing: { baseCommit: "a".repeat(40), campaignBranch: "campaign/C-1", targetBranch: "main" },
      push: { enabled: false, remote: null, branch: null },
    },
    waves: [
      { id: "wave-1", label: "Wave 1", taskIds: ["QK-1"] },
      { id: "wave-2", label: "Wave 2", taskIds: ["QK-2"] },
    ],
    lanes: [{ id: "lane-1", label: "Lane 1", runner: "cursor", model: "composer-2.5", taskIds: ["QK-1", "QK-2"] }],
    tasks: [
      {
        taskId: "QK-1",
        title: "Contract task",
        waveId: "wave-1",
        laneId: "lane-1",
        route: { profileId: "cursor", tier: "standard", effort: "standard" },
        fallback: { profileId: "codex-gpt", tier: "high", effort: "standard" },
        confidence: "high",
      },
      {
        taskId: "QK-2",
        title: "Integration task",
        waveId: "wave-2",
        laneId: "lane-1",
        route: { profileId: "claude-opus", tier: "high", effort: "high" },
        fallback: null,
        confidence: "medium",
      },
    ],
    inspector: {
      taskId: "QK-1",
      routingRationale: "Best healthy match for schema work.",
      tests: ["pnpm test"],
      acceptanceProof: "Contract fixtures pass.",
    },
    residuals: ["Pending provider acknowledgement"],
    humanGates: ["Design approval before execution"],
    unsupportedCapabilities: ["remote-git-push"],
    approval: { campaignId: "C-1", envelopeDigest: "sha256:preflight-digest" },
  };
}

function existingTasksProjection(): UiExistingTasksV1 {
  return {
    schemaVersion: 1,
    refreshedAt: "2026-07-22T12:00:00.000Z",
    coordinationNotice: "Local coordination only",
    leaseNotice: "No shared lease",
    source: { driver: "json", protocol: "task-source-v1", pendingWrites: 0, conflicts: 0, syncHealth: "fresh" },
    tasks: [
      {
        id: "QK-1",
        title: "Contract task",
        kind: "implementation",
        priority: "P1",
        status: "ready",
        readiness: "ready",
        blockers: [],
        workflowPhase: "execute",
        designGate: { required: false, mode: "human", delegable: false },
        risk: ["architecture"],
        effort: "standard",
        suggestedRoute: { tier: "standard", label: "Composer 2.5" },
        source: { driver: "json", nativeId: "QK-1", webUrl: null },
        nativeRevision: "sha256:abc",
        dependsOn: [],
        coordination: null,
      },
      {
        id: "QK-2",
        title: "Integration task",
        kind: "implementation",
        priority: "P1",
        status: "blocked",
        readiness: "blocked",
        blockers: ["Depends on QK-1"],
        workflowPhase: "execute",
        designGate: { required: false, mode: "human", delegable: false },
        risk: [],
        effort: "high",
        suggestedRoute: { tier: "high", label: "High judgment" },
        source: { driver: "json", nativeId: "QK-2", webUrl: null },
        nativeRevision: "sha256:def",
        dependsOn: ["QK-1"],
        coordination: null,
      },
      {
        id: "QK-3",
        title: "Design gate task",
        kind: "design",
        priority: "P2",
        status: "ready",
        readiness: "blocked",
        blockers: ["Design gate approval required"],
        workflowPhase: "brainstorm",
        designGate: { required: true, mode: "human", delegable: false },
        risk: [],
        effort: "standard",
        suggestedRoute: { tier: "standard", label: "Composer 2.5" },
        source: { driver: "json", nativeId: "QK-3", webUrl: null },
        nativeRevision: "sha256:ghi",
        dependsOn: [],
        coordination: null,
      },
    ],
  };
}

function campaignSummaries(): UiCampaignSummaryItem[] {
  return [
    {
      campaignId: "C-1",
      repositoryId: "repo-1",
      state: "running",
      taskCount: 2,
      startedAt: "2026-07-21T12:00:00.000Z",
    },
    {
      campaignId: "C-0",
      repositoryId: "repo-1",
      state: "complete",
      taskCount: 3,
      startedAt: "2026-07-20T09:00:00.000Z",
      finishedAt: "2026-07-20T15:00:00.000Z",
      outcome: "Landed via PR #41",
    },
  ];
}

function campaignDetail(): UiCampaignDetail {
  return {
    campaignId: "C-1",
    repositoryId: "repo-1",
    state: "running",
    taskCount: 1,
    tasks: [{ taskId: "QK-1", title: "Contract task", status: "running" }],
    waves: [{ id: "w1", label: "Wave 1" }],
    runners: [{ id: "r1", kind: "cursor", model: "composer-2.5" }],
    commits: [{ sha: "b".repeat(40), message: "feat: change" }],
    pullRequests: [],
    verification: [{ label: "pnpm test", outcome: "passed" }],
    sync: { pending: 0, conflicts: 0 },
  };
}

function taskHistoryProjection(): UiTaskHistoryV1 {
  return {
    schemaVersion: 1,
    taskId: "QK-1",
    iterations: [
      {
        id: "iteration-1",
        outcome: "completed",
        artifactRefs: [
          {
            kind: "plan",
            path: "docs/superpowers/plans/plan.md",
            commit: "207c92e",
            sha: "207c92e",
            url: null,
            availability: "available",
            actions: ["open-as-executed", "open-current", "compare"],
            identities: [{ label: "Operator", evidence: "git-signature", verified: true }],
          },
        ],
      },
    ],
  };
}

/** Projection whose refs carry every provenance kind plus one legacy ref without a kind. */
function typedTaskHistoryProjection(): UiTaskHistoryV1 {
  const base = {
    commit: "207c92e",
    sha: "207c92e",
    url: null,
    availability: "available" as const,
    actions: ["open-as-executed", "open-current", "compare"] as UiTaskHistoryV1["iterations"][number]["artifactRefs"][number]["actions"],
    identities: [],
  };
  return {
    schemaVersion: 1,
    taskId: "QK-1",
    iterations: [
      {
        id: "iteration-1",
        outcome: "completed",
        artifactRefs: [
          { ...base, kind: "spec", path: "docs/superpowers/specs/spec.md" },
          { ...base, kind: "plan", path: "docs/superpowers/plans/plan.md" },
          { ...base, kind: "review", path: "docs/reviews/review.md" },
          { ...base, kind: "other", path: "docs/notes/context.md" },
          { ...base, path: "docs/legacy/no-kind.md" },
        ],
      },
      {
        id: "iteration-2",
        outcome: "completed",
        // Same governed spec at the same revision: the governing panel dedupes it.
        artifactRefs: [{ ...base, kind: "spec", path: "docs/superpowers/specs/spec.md" }],
      },
    ],
  };
}

test("ships the approved workspace composition classes and palette", async () => {
  // Compiled location: dist/test/ui/client → repository root is four levels up.
  const root = path.resolve(import.meta.dirname, "../../../..");
  const css = await readFile(path.join(root, "src/ui/styles.ts"), "utf8");
  for (const token of [
    "--ui-canvas",
    "--ui-panel",
    "--ui-nav",
    "--ui-line",
    "--ui-ink",
    "--ui-muted",
    "--ui-success",
    "--ui-warning",
    "--ui-danger",
    "--ui-claude",
    "--ui-codex",
    "--ui-cursor",
  ]) {
    assert.match(css, new RegExp(token));
  }
  for (const className of [
    "workspace-header",
    "summary-grid",
    "workspace-panel",
    "workspace-toolbar",
    "workspace-layout",
    "status-badge--success",
    "status-badge--warning",
    "status-badge--danger",
    "data-table-wrapper",
    "approval-footer",
  ]) {
    assert.match(css, new RegExp(`\\.${className}`));
  }
  assert.match(css, /#f3f6fa/);
  assert.match(css, /#111827/);
  assert.match(css, /#182230/);
  assert.match(css, /max-width:\s*900px/);
  assert.match(css, /max-width:\s*620px/);
});

test("preflight composes header, summary metrics, wave map, inspector, and bounded approval footer", () => {
  const html = renderToStaticMarkup(createElement(PreflightProposalView, { proposal: preflightProposal() }));
  assert.match(html, /workspace-header/);
  assert.match(html, /summary-grid/);
  assert.match(html, /workspace-layout/);
  assert.match(html, /wave-map/);
  assert.match(html, /workspace-inspector/);
  // Exact class match: the child .approval-footer-inner cannot satisfy this.
  assert.match(html, /class="approval-footer"/);
  assert.match(html, /PREFLIGHT · PROPOSAL ONLY/);
  assert.match(html, /Nothing has started/);
  // The map never repeats task titles; the complete list is the single title authority.
  assert.equal((html.match(/Contract task/g) ?? []).length, 1);
  // No dead routing controls from the mock (no server capability).
  assert.doesNotMatch(html, /Edit routing/);
  assert.doesNotMatch(html, /Use current agent only/);
});

function durablePreflightProposal(): UiPreflightProposalV1 {
  const base = preflightProposal();
  return {
    ...base,
    summary: {
      ...base.summary,
      waveCount: null,
      estimatedMinutes: null,
      confidence: "unavailable",
    },
    waves: [],
    lanes: [],
    tasks: base.tasks.map((task) => ({
      ...task,
      waveId: null,
      laneId: null,
      confidence: "unavailable" as const,
    })),
    inspector: null,
  };
}

test("preflight renders durable proposals honestly and suppresses read-only approval", () => {
  const html = renderToStaticMarkup(
    createElement(PreflightProposalView, { proposal: durablePreflightProposal(), approvalAvailable: false }),
  );
  // Nullable summary fields render honest unavailability, never "null waves".
  assert.match(html, />Unavailable</);
  assert.doesNotMatch(html, /null waves|null min/);
  assert.match(html, /Confidence unavailable/);
  // Empty wave/lane projections keep the explicit durable-envelope copy, once each.
  assert.equal(
    (html.match(/Wave assignments are not recorded in the durable campaign envelope\./g) ?? []).length,
    1,
  );
  assert.equal(
    (html.match(/Agent lane details are not recorded in the durable campaign envelope\./g) ?? []).length,
    1,
  );
  // Read-only workspaces suppress the approval form with the honest copy.
  assert.doesNotMatch(html, /Approve campaign/);
  assert.doesNotMatch(html, /reviewed the preflight proposal/);
  assert.match(html, /This workspace is read-only and holds no approval credential\./);
  // The digest stays visible even when approval is suppressed.
  assert.match(html, /envelope-digest/);
});

test("existing tasks compose stats, toolbar, frontier map, table, and inspector aside", () => {
  const html = renderToStaticMarkup(createElement(ExistingTasksView, { projection: existingTasksProjection() }));
  assert.match(html, /summary-grid/);
  assert.match(html, /workspace-toolbar/);
  assert.match(html, /workspace-layout/);
  assert.match(html, /frontier-map/);
  assert.match(html, /workspace-inspector/);
  assert.match(html, /data-table-wrapper/);
  // v4 amber design tint: design-gate work is distinguishable from dependency blocks.
  assert.match(html, /mini-card--design/);
  assert.match(html, /QK-3 · Needs design/);
  assert.doesNotMatch(html, /QK-2 · Needs design/);
  // v4 toolbar chips include the design-gate filter.
  assert.match(html, /Needs design<\/button>/);
  // No dead selection controls from the mock (no proposal-build server capability).
  assert.doesNotMatch(html, /Build campaign proposal/);
  // Table stays the single exact-id and title authority for strict locators.
  assert.equal((html.match(/Contract task/g) ?? []).length, 1);
});

test("campaigns compose stats, active-campaign promotion, and history table", async () => {
  const html = await renderWithRouter(createElement(CampaignsView, { items: campaignSummaries() }));
  assert.match(html, /summary-grid/);
  assert.match(html, /active-campaign/);
  assert.match(html, /Open live campaign/);
  assert.match(html, /data-table-wrapper/);
  assert.doesNotMatch(html, /Runner health/);
});

test("campaign detail reuses the shared shell primitives", async () => {
  const html = await renderWithRouter(createElement(CampaignDetailView, { detail: campaignDetail() }));
  assert.match(html, /workspace-header/);
  assert.match(html, /summary-grid/);
  assert.match(html, /workspace-panel/);
  assert.match(html, /wave-steps/);
  assert.match(html, /A past campaign is immutable/);
});

test("task history composes header stats, artifact cards, iteration timeline, and provenance rail", () => {
  const html = renderToStaticMarkup(createElement(TaskHistoryView, { projection: taskHistoryProjection() }));
  assert.match(html, /workspace-header/);
  assert.match(html, /summary-grid/);
  assert.match(html, /artifact-card/);
  assert.match(html, /iteration-card/);
  assert.match(html, /provenance-rail/);
  assert.match(html, /Local coordination only/);
  // The eyebrow shows the ordinal, not the raw journal id; the id stays visible elsewhere.
  assert.match(html, />Iteration 1</);
  assert.doesNotMatch(html, />Iteration iteration-1</);
  assert.match(html, /Journal id iteration-1/);
  // Exact internal Git actions survive the recomposition.
  assert.match(html, /href="\/git\/open\?path=docs%2Fsuperpowers%2Fplans%2Fplan\.md&amp;commit=207c92e"/);
});

test("task history renders v5 typed file cards with a governing-files grouping", () => {
  const html = renderToStaticMarkup(createElement(TaskHistoryView, { projection: typedTaskHistoryProjection() }));
  // Governing files panel groups refs of kind spec/plan/review (v5 §2.5).
  assert.match(html, /Governing files/);
  assert.match(html, /References only · exact historical revisions preserved/);
  // Typed kind chips per card, from real provenance kinds only.
  assert.match(html, /data-kind="spec"[^>]*>Superpowers spec</);
  assert.match(html, /data-kind="plan"[^>]*>Implementation plan</);
  assert.match(html, /data-kind="review"[^>]*>Independent review</);
  // "other" and absent kinds render the generic card and never join the governing group.
  assert.match(html, /Artifact ref/);
  assert.doesNotMatch(html, /data-kind="other"[^>]*>(?:Superpowers spec|Implementation plan|Independent review)</);
  const governing = html.slice(html.indexOf("Governing files"), html.indexOf("Iteration history"));
  assert.doesNotMatch(governing, /docs\/notes\/context\.md/);
  assert.doesNotMatch(governing, /docs\/legacy\/no-kind\.md/);
  // The duplicate spec ref (same kind, path, revision) appears once in the governing panel.
  assert.equal(governing.split("docs/superpowers/specs/spec.md").length - 1, 1);
});

test("task history without kind data renders generic cards and no governing panel", () => {
  const projection = taskHistoryProjection();
  for (const iteration of projection.iterations) {
    for (const artifactRef of iteration.artifactRefs) {
      delete (artifactRef as { kind?: string }).kind;
    }
  }
  const html = renderToStaticMarkup(createElement(TaskHistoryView, { projection }));
  assert.doesNotMatch(html, /Governing files/);
  assert.match(html, /Artifact ref/);
});
