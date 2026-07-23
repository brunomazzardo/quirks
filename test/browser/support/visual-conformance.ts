import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { TaskHistory } from "../../../src/provenance/types.js";
import type { UiCampaignSummaryItem } from "../../../src/ui/ports/campaign-read.js";
import type { UiPreflightProposalV1 } from "../../../src/ui/types/preflight-proposal.js";
import { launchUiFixture, type UiFixture } from "./launch-ui.js";

/**
 * QK-VIS-003 deterministic reproduction support.
 *
 * Every value rendered by the conformance surfaces comes from the constants in
 * this module, the committed visual-project ledger fixture, or the frozen test
 * clock — never from live repositories, journals, git metadata, or wall-clock
 * time. That is what makes the committed screenshot baselines comparable.
 */

const RULES_PATH = path.resolve("test/ui/fixtures/visual-conformance-rules.json");

export interface ConformanceRules {
  schemaVersion: number;
  protocol: string;
  theme: string;
  animations: string;
  baselinePlatform: string;
  baselineDirectory: string;
  maxDiffPixelRatio: number;
  determinism: readonly string[];
  viewports: {
    desktop: { width: number; height: number };
    compact: { width: number; height: number };
  };
  surfaces: readonly {
    id: string;
    route: string;
    reference: string | null;
    state: string;
    rules: readonly string[];
  }[];
  promptSurfaces: string;
  acceptedDivergences: readonly { id: string; summary: string; pointer: string }[];
}

export const CONFORMANCE_RULES: ConformanceRules = JSON.parse(readFileSync(RULES_PATH, "utf8"));

export function screenshotOptions() {
  return {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: CONFORMANCE_RULES.maxDiffPixelRatio,
  } as const;
}

const CAMPAIGN_ID = "C-1";
const ISSUED_DIGEST = "sha256:abc";

/** Synthetic full-length commits: valid for the history schema, stable across runs. */
const COMMIT_A = "a1".repeat(20);
const COMMIT_B = "b2".repeat(20);
const COMMIT_C = "c3".repeat(20);
const COMMIT_D = "d4".repeat(20);

/**
 * Rich preflight proposal mirroring approval-workspace-v3's shape: four waves
 * left→right, six tasks, all three agent identities plus a control-plane
 * profile, and a selected-task inspector.
 */
function route(profileId: string, tier: "standard" | "high", effort: "standard" | "high") {
  return { profileId, tier, effort };
}

export function conformancePreflightProposal(): UiPreflightProposalV1 {
  return {
    schemaVersion: 1,
    campaignId: CAMPAIGN_ID,
    state: "awaiting_approval",
    envelopeDigest: ISSUED_DIGEST,
    summary: {
      taskCount: 6,
      waveCount: 4,
      estimatedMinutes: 54,
      confidence: "medium",
      budget: { maxWallClockMs: 3_600_000, maxConcurrency: 2 },
      landing: {
        baseCommit: COMMIT_A,
        campaignBranch: `campaign/${CAMPAIGN_ID}`,
        targetBranch: "main",
      },
      push: { enabled: false, remote: null, branch: null },
    },
    waves: [
      { id: "wave-0", label: "Wave 0 · Design gate", taskIds: ["QK-101"] },
      { id: "wave-1", label: "Wave 1 · Parallel lanes", taskIds: ["QK-102", "QK-103"] },
      { id: "wave-2", label: "Wave 2 · Integrate", taskIds: ["QK-104"] },
      { id: "wave-3", label: "Wave 3 · Independent gates", taskIds: ["QK-105", "QK-106"] },
    ],
    lanes: [
      { id: "lane-a", label: "Lane A", runner: "cursor", model: "composer-2.5", taskIds: ["QK-102", "QK-106"] },
      { id: "lane-b", label: "Lane B", runner: "codex", model: "gpt-5.6-sol", taskIds: ["QK-103", "QK-104"] },
    ],
    tasks: [
      {
        taskId: "QK-101",
        title: "Finalize runner contract",
        waveId: "wave-0",
        laneId: null,
        route: route("claude-opus", "high", "high"),
        fallback: null,
        confidence: "high",
      },
      {
        taskId: "QK-102",
        title: "Runner profile schema",
        waveId: "wave-1",
        laneId: "lane-a",
        route: route("cursor", "standard", "standard"),
        fallback: route("codex-gpt", "standard", "standard"),
        confidence: "high",
      },
      {
        taskId: "QK-103",
        title: "Claude process adapter",
        waveId: "wave-1",
        laneId: "lane-b",
        route: route("codex-gpt", "high", "high"),
        fallback: route("cursor", "high", "standard"),
        confidence: "medium",
      },
      {
        taskId: "QK-104",
        title: "Dispatcher lifecycle",
        waveId: "wave-2",
        laneId: "lane-b",
        route: route("codex-gpt", "high", "high"),
        fallback: route("cursor", "high", "high"),
        confidence: "low",
      },
      {
        taskId: "QK-105",
        title: "Cross-provider review",
        waveId: "wave-3",
        laneId: null,
        route: route("claude-opus", "high", "high"),
        fallback: null,
        confidence: "medium",
      },
      {
        taskId: "QK-106",
        title: "Integration verification",
        waveId: "wave-3",
        laneId: "lane-a",
        route: route("quirks-control", "standard", "standard"),
        fallback: null,
        confidence: "high",
      },
    ],
    inspector: {
      taskId: "QK-104",
      routingRationale:
        "Best healthy match for process lifecycle and protocol work. Claude quota remains reserved for independent review.",
      tests: ["Spawn/result contract", "Permission-denial fixture", "Crash and resume recovery", "Scoped cancellation"],
      acceptanceProof: "Twelve lifecycle tests pass and the independent review accepts the branch.",
    },
    residuals: ["Pending provider acknowledgement for task sync"],
    humanGates: ["Design approval before execution"],
    unsupportedCapabilities: ["remote-git-push"],
    approval: { campaignId: CAMPAIGN_ID, envelopeDigest: ISSUED_DIGEST },
  };
}

/** v4 campaign workspace state: one promoted live campaign plus history in every terminal shade. */
export function conformanceCampaignSummaries(): UiCampaignSummaryItem[] {
  return [
    {
      campaignId: CAMPAIGN_ID,
      repositoryId: "sha256:repo-1",
      state: "running",
      taskCount: 2,
      startedAt: "2026-07-21T12:00:00.000Z",
    },
    {
      campaignId: "C-0",
      repositoryId: "sha256:repo-1",
      state: "complete",
      taskCount: 3,
      startedAt: "2026-07-20T09:00:00.000Z",
      finishedAt: "2026-07-20T15:00:00.000Z",
      spend: { "cursor:composer-2.5": 1200 },
      outcome: "Landed via PR #41",
    },
    {
      campaignId: "C-PAUSE",
      repositoryId: "sha256:repo-1",
      state: "paused",
      taskCount: 5,
      startedAt: "2026-07-19T10:00:00.000Z",
    },
    {
      campaignId: "C-HOLD",
      repositoryId: "sha256:repo-1",
      state: "hold",
      taskCount: 7,
      startedAt: "2026-07-18T10:00:00.000Z",
      finishedAt: "2026-07-18T14:30:00.000Z",
    },
  ];
}

/**
 * v5 provenance state: two iterations (a completed landing and an earlier
 * partial), governing spec/plan/review refs, and identities spanning the
 * verified and self-asserted evidence shades. Commits are synthetic constants
 * so rendered text never varies between runs.
 */
export function conformanceTaskHistory(): TaskHistory {
  const operator = { label: "operator:local", evidence: "authenticated-host", verified: true } as const;
  const signed = { label: "Signed Committer <fixture@example.invalid>", evidence: "git-signature", verified: true } as const;
  const unsigned = {
    label: "Local Author <fixture@example.invalid>",
    evidence: "self-asserted-git-metadata",
    verified: false,
  } as const;
  return {
    schemaVersion: 1,
    taskId: "QK-1",
    entries: [
      {
        iteration: {
          id: "iter-1",
          outcome: "partial",
          completionBoundary: "accepted-commit",
          campaignId: "C-0",
          operator,
          gitAuthor: unsigned,
          gitCommitter: unsigned,
          participants: [{ role: "agent", runner: "cursor", model: "composer-2.5", effort: "standard" }],
        },
        artifactRefs: [
          {
            // "other" kinds stay generic cards and never join the governing panel.
            ref: { kind: "other", path: "docs/notes/QK-1-context.md", commit: COMMIT_B },
            availability: "missing-at-commit",
          },
        ],
        commitRefs: [{ sha: COMMIT_B, availability: "available", author: unsigned, committer: unsigned }],
        pullRequestRefs: [],
        verificationRefs: [],
        journalEventIds: ["evt-1"],
        derived: { commitCount: 1 },
      },
      {
        iteration: {
          id: "iter-2",
          outcome: "completed",
          completionBoundary: "accepted-commit",
          campaignId: CAMPAIGN_ID,
          operator,
          gitAuthor: signed,
          gitCommitter: signed,
          participants: [{ role: "agent", runner: "codex", model: "gpt-5.6-sol", effort: "high" }],
        },
        artifactRefs: [
          {
            ref: { kind: "spec", path: "docs/superpowers/specs/portable-agent-campaigns.md", commit: COMMIT_A },
            availability: "available",
          },
          {
            ref: { kind: "plan", path: "docs/superpowers/plans/quirks-local-control-ui.md", commit: COMMIT_C },
            availability: "available",
          },
          {
            ref: { kind: "review", path: "docs/reviews/QK-1-adversarial-review.md", commit: COMMIT_D },
            availability: "available",
          },
        ],
        commitRefs: [{ sha: COMMIT_D, availability: "available", author: signed, committer: signed }],
        pullRequestRefs: [],
        verificationRefs: [],
        journalEventIds: ["evt-2"],
        derived: { commitCount: 1 },
      },
    ],
    totalIterations: 2,
    partialCount: 1,
    supersededCount: 0,
  };
}

export type ConformanceUi = UiFixture & {
  tasksUrl: string;
  campaignsUrl: string;
  taskHistoryUrl: (taskId: string) => string;
};

/**
 * Launches the UI against the deterministic conformance fixtures: the
 * visual-project ledger, the four-wave preflight proposal, the mixed-state
 * campaign summaries, and the two-iteration task history. QUIRKS_STATE_DIR is
 * pointed at a throwaway directory so sync-outbox state never leaks in.
 */
const execFileAsync = promisify(execFile);

let projectRootPromise: Promise<string> | undefined;

/**
 * The visual-project ledger must be its own git toplevel: project resolution
 * walks to `git rev-parse --show-toplevel`, so a fixture directory inside this
 * repository would serve the live repository ledger instead (nondeterministic).
 * The committed fixture is copied to a temp repo once per worker.
 */
async function initializedProjectRoot(): Promise<string> {
  projectRootPromise ??= (async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "quirks-visual-conformance-project-"));
    await cp(path.resolve("test/ui/fixtures/visual-project"), root, { recursive: true });
    await execFileAsync("git", ["init", root]);
    return root;
  })();
  return projectRootPromise;
}

export async function launchConformanceUi(): Promise<ConformanceUi> {
  process.env.QUIRKS_STATE_DIR ??= await mkdtemp(path.join(os.tmpdir(), "quirks-visual-conformance-env-"));
  const history = conformanceTaskHistory();
  const ui = await launchUiFixture({
    campaignId: CAMPAIGN_ID,
    projectRoot: await initializedProjectRoot(),
    preflightProposals: { [CAMPAIGN_ID]: conformancePreflightProposal() },
    campaignSummaries: conformanceCampaignSummaries(),
    taskHistory: {
      getHistory: async (taskId: string) => {
        if (taskId === history.taskId) return history;
        return {
          schemaVersion: 1,
          taskId,
          entries: [],
          totalIterations: 0,
          partialCount: 0,
          supersededCount: 0,
        };
      },
    },
  });
  return {
    ...ui,
    tasksUrl: ui.viewerUrl("/"),
    campaignsUrl: ui.viewerUrl("/campaigns"),
    taskHistoryUrl: (taskId: string) => ui.viewerUrl(`/tasks/${taskId}/history`),
  };
}
