import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { consumeApprovalToken, createApprovalChallenge } from "../campaign/approval.js";
import { finalizeEnvelope, stripDigest } from "../campaign/envelope.js";
import { runPreflight } from "../campaign/preflight.js";
import { createCampaignRuntime } from "../campaign/runtime-context.js";
import type { GitWorktreePort, WorktreePort } from "../campaign/ports.js";
import type { ResolvedRoute } from "../campaign/routing.js";
import { CampaignStore } from "../campaign/store.js";
import type { CampaignEnvelope } from "../campaign/types.js";
import { QuirksError } from "../core/errors.js";
import { mergeCampaignToTarget } from "../git/landing.js";
import { runGit } from "../git/argv.js";
import { loadProjectContext } from "../project/config.js";
import { canonicalRepository } from "../project/repository.js";
import { loadRunnerProfiles } from "../runner/profiles.js";
import type { RunnerProfile } from "../runner/types.js";
import { SessionRegistry } from "../runner/sessions.js";
import { reconcileMutation } from "../sync/reconciler.js";
import { SyncOutbox } from "../sync/outbox.js";
import { createTaskSource } from "../task-source/factory.js";
import { disposeTaskSource } from "../task-source/task-source.js";
import type { MutationRequest } from "../task-source/types.js";
import { BOUNDED_CAMPAIGN_APPROVAL_ENV } from "./types.js";
import { resolveExecutable } from "./host-runner.js";

const execFileAsync = promisify(execFile);
const FIXTURE = path.resolve("test/fixtures/real-campaign");
const FAKE_RUNNERS = path.resolve("test/fixtures/fake-runners");

export const BOUNDED_TASK_ID = "QK-BOUNDED-001";
export const BOUNDED_APPROVED_MESSAGE = "Quirks bounded campaign accepted.";
export const BOUNDED_REVIEW_PATH = `.quirks/reviews/${BOUNDED_TASK_ID}.md`;

export interface BoundedCampaignOptions {
  fixtureRoot?: string;
  bareRemote?: string;
  remoteName?: string;
  branch?: string;
  profileId?: string;
  approved?: boolean;
  configDir?: string;
  stateDir?: string;
  useFakeRunners?: boolean;
}

export interface BoundedCampaignResult {
  campaignId: string;
  taskId: string;
  taskStatus: string;
  changedFiles: readonly string[];
  acceptedCommit: string;
  remoteHead: string;
  review: { outcome: "approved" | "rejected" | "blocked" };
  pendingSyncIntents: number;
  approvalMethod: string;
  elapsedMs: number;
}

export function isApprovedBoundedCampaign(approved?: boolean): boolean {
  if (approved === true) return true;
  if (approved === false) return false;
  return process.env.QUIRKS_SMOKE_APPROVED === BOUNDED_CAMPAIGN_APPROVAL_ENV;
}

async function gitExec(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await runGit(cwd, args);
  return stdout.trim();
}

async function remoteHead(bareRemote: string, branch: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["--git-dir", bareRemote, "rev-parse", branch]);
  return stdout.toString().trim();
}

async function executableFakeRunner(scriptName: string, configDir: string): Promise<string> {
  await cp(path.join(FAKE_RUNNERS, "shared-modes.mjs"), path.join(configDir, "shared-modes.mjs"));
  const source = path.join(FAKE_RUNNERS, scriptName);
  const target = path.join(configDir, scriptName);
  const original = await readFile(source, "utf8");
  await writeFile(target, `#!/usr/bin/env node\n${original}`, "utf8");
  await chmod(target, 0o755);
  return target;
}

async function writeFakeProfilesConfig(configDir: string): Promise<void> {
  const implementer = await executableFakeRunner("bounded-implementer.mjs", configDir);
  const reviewer = await executableFakeRunner("bounded-reviewer-codex.mjs", configDir);
  await writeFile(
    path.join(configDir, "profiles.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      tierAliases: {
        "bounded-claude": { tier: "standard" },
        "bounded-codex": { tier: "high" },
      },
      profiles: [
        {
          schemaVersion: 1,
          profileId: "bounded-implementer-claude",
          runnerType: "claude",
          executable: implementer,
          accountAlias: "bounded",
          quotaPoolId: "pool-bounded-impl",
          tier: "standard",
          model: "bounded-claude",
          effort: "standard",
          capabilities: ["repository-read", "repository-write"],
          wallClockMs: 120_000,
          redactionRules: [],
        },
        {
          schemaVersion: 1,
          profileId: "bounded-reviewer-codex",
          runnerType: "codex",
          executable: reviewer,
          accountAlias: "bounded",
          quotaPoolId: "pool-bounded-rev",
          tier: "high",
          model: "bounded-codex",
          effort: "high",
          capabilities: ["repository-read"],
          wallClockMs: 120_000,
          redactionRules: [],
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
}

async function writeEphemeralProfilesConfig(
  configDir: string,
  implementerProfileId: string,
): Promise<void> {
  const profiles = await loadRunnerProfiles();
  const implementer = profiles.find((profile) => profile.profileId === implementerProfileId);
  if (!implementer) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Unknown runner profile ${implementerProfileId}`);
  }
  const reviewerType = implementer.runnerType === "claude"
    ? "codex"
    : implementer.runnerType === "codex"
      ? "cursor"
      : "claude";
  const reviewerExecutable = await resolveExecutable(
    reviewerType === "claude" ? "claude" : reviewerType === "codex" ? "codex" : "cursor-agent",
  );
  if (!reviewerExecutable) {
    throw new QuirksError("PROTOCOL_VIOLATION", `No executable found for cross-vendor reviewer ${reviewerType}`);
  }
  const reviewerProfile: RunnerProfile = {
    schemaVersion: 1,
    profileId: `bounded-reviewer-${reviewerType}`,
    runnerType: reviewerType,
    executable: reviewerExecutable,
    accountAlias: implementer.accountAlias,
    quotaPoolId: `pool-bounded-reviewer-${reviewerType}`,
    tier: "high",
    model: implementer.model,
    effort: "high",
    capabilities: ["repository-read"],
    wallClockMs: implementer.wallClockMs,
    redactionRules: [],
  };
  await mkdir(configDir, { recursive: true });
  await writeFile(
    path.join(configDir, "profiles.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      tierAliases: {},
      profiles: [implementer, reviewerProfile],
    }, null, 2)}\n`,
    "utf8",
  );
}

export async function prepareBoundedFixtureRoot(root?: string): Promise<string> {
  const fixtureRoot = root ?? await mkdtemp(path.join(os.tmpdir(), "quirks-bounded-fixture-"));
  const marker = path.join(fixtureRoot, ".agents", "quirks.json");
  try {
    await readFile(marker, "utf8");
    return fixtureRoot;
  } catch {
    await cp(FIXTURE, fixtureRoot, { recursive: true });
    await execFileAsync("git", ["init", fixtureRoot]);
    await execFileAsync("git", ["-C", fixtureRoot, "config", "user.email", "bounded@quirks.test"]);
    await execFileAsync("git", ["-C", fixtureRoot, "config", "user.name", "Bounded Fixture"]);
    await execFileAsync("git", ["-C", fixtureRoot, "add", "."]);
    await execFileAsync("git", ["-C", fixtureRoot, "commit", "-m", "bounded fixture"]);
    return fixtureRoot;
  }
}

export async function createBoundedBareRemote(fixtureRoot: string, branch: string): Promise<{
  bareRemote: string;
  remoteName: string;
}> {
  const bareRemote = await mkdtemp(path.join(os.tmpdir(), "quirks-bounded-remote-"));
  await execFileAsync("git", ["init", "--bare", bareRemote]);
  const remoteName = "origin";
  await execFileAsync("git", ["-C", fixtureRoot, "remote", "add", remoteName, bareRemote]);
  await execFileAsync("git", ["-C", fixtureRoot, "push", "-u", remoteName, `HEAD:${branch}`]);
  return { bareRemote, remoteName };
}

function isGitWorktreePort(worktree: WorktreePort): worktree is GitWorktreePort {
  return typeof (worktree as GitWorktreePort).prepareReviewWorktree === "function";
}

function routeForTask(
  envelope: CampaignEnvelope,
  taskId: string,
  role: "implementer" | "reviewer",
  profileIndex: ReadonlyMap<string, RunnerProfile>,
): ResolvedRoute {
  const routing = envelope.routing[taskId];
  if (!routing) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Missing routing for task ${taskId}`);
  }
  const selected = role === "reviewer" && routing.fallbacks[0] ? routing.fallbacks[0] : routing.primary;
  const profile = profileIndex.get(selected.profileId);
  return {
    profileId: selected.profileId,
    runnerType: profile?.runnerType ?? "cursor",
    tier: selected.tier,
    effort: selected.effort,
    quotaPoolId: profile?.quotaPoolId ?? "default",
  };
}

async function mutateAcknowledged(input: {
  campaignId: string;
  outbox: SyncOutbox;
  source: Awaited<ReturnType<typeof createTaskSource>>;
  request: MutationRequest;
}): Promise<string> {
  const intent = await reconcileMutation(input);
  if (intent.state !== "acknowledged") {
    throw new QuirksError("PROTOCOL_VIOLATION", `${input.request.operation} was not acknowledged`);
  }
  const show = await input.source.execute({
    schemaVersion: 1,
    operation: "show",
    taskId: input.request.taskId,
    input: {},
  });
  if (!show.ok || !show.nativeRevision) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Cannot show task ${input.request.taskId} after ${input.request.operation}`);
  }
  return show.nativeRevision;
}

function buildBrief(): string {
  return [
    `# ${BOUNDED_TASK_ID}`,
    "",
    "Replace src/message.txt with exactly this string and commit only that file:",
    BOUNDED_APPROVED_MESSAGE,
  ].join("\n");
}

async function listChangedFiles(repositoryRoot: string, baseCommit: string, headCommit: string): Promise<string[]> {
  const { stdout } = await runGit(repositoryRoot, ["diff", "--name-only", baseCommit, headCommit]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function syncTaskLedgerCommit(repositoryRoot: string): Promise<void> {
  const { stdout } = await runGit(repositoryRoot, ["status", "--porcelain", ".quirks/tasks.json"]);
  if (stdout.trim().length === 0) return;
  await gitExec(repositoryRoot, ["add", ".quirks/tasks.json"]);
  await gitExec(repositoryRoot, ["commit", "-m", "sync bounded campaign task ledger"]);
}

export async function runBoundedCampaign(options: BoundedCampaignOptions = {}): Promise<BoundedCampaignResult> {
  const started = Date.now();
  if (!isApprovedBoundedCampaign(options.approved)) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Set QUIRKS_SMOKE_APPROVED=${BOUNDED_CAMPAIGN_APPROVAL_ENV}`);
  }

  const branch = options.branch ?? "quirks-smoke";
  const fixtureRoot = await prepareBoundedFixtureRoot(options.fixtureRoot);
  const stateDir = options.stateDir ?? await mkdtemp(path.join(os.tmpdir(), "quirks-bounded-state-"));
  const configDir = options.configDir ?? await mkdtemp(path.join(os.tmpdir(), "quirks-bounded-config-"));
  const remoteInfo = options.bareRemote
    ? { bareRemote: options.bareRemote, remoteName: options.remoteName ?? "origin" }
    : await createBoundedBareRemote(fixtureRoot, branch);

  if (options.useFakeRunners !== false && !options.profileId) {
    await writeFakeProfilesConfig(configDir);
  } else if (options.profileId) {
    await writeEphemeralProfilesConfig(configDir, options.profileId);
  } else {
    await writeFakeProfilesConfig(configDir);
  }

  const previousStateDir = process.env.QUIRKS_STATE_DIR;
  const previousConfigDir = process.env.QUIRKS_CONFIG_DIR;
  process.env.QUIRKS_STATE_DIR = stateDir;
  process.env.QUIRKS_CONFIG_DIR = configDir;
  process.env.QUIRKS_BOUNDED_APPROVED_MESSAGE = BOUNDED_APPROVED_MESSAGE;
  process.env.QUIRKS_BOUNDED_REVIEW_PATH = BOUNDED_REVIEW_PATH;

  try {
    const { root } = await canonicalRepository(fixtureRoot);
    const project = await loadProjectContext(root, { mode: "unattended" });
    const source = await createTaskSource(project);
    const outbox = SyncOutbox.open(path.join(stateDir, "bounded-outbox.jsonl"));

    const preflight = await runPreflight({
      repositoryRoot: root,
      selectedTaskIds: [BOUNDED_TASK_ID],
      externalRoutingEnabled: true,
      configDir,
      push: { enabled: true, remote: remoteInfo.remoteName, branch },
    });
    if (preflight.blockers.length > 0) {
      throw new QuirksError("PROTOCOL_VIOLATION", preflight.blockers.join("; "));
    }

    const envelope = finalizeEnvelope({
      ...stripDigest(preflight.envelope),
      budgets: {
        ...preflight.envelope.budgets,
        maxWallClockMs: Math.max(preflight.envelope.budgets.maxWallClockMs, 3_600_000),
      },
    });

    const store = await CampaignStore.create({
      stateDir,
      repositoryId: envelope.repositoryId,
      campaignId: envelope.campaignId,
      envelope,
    });

    const challenge = createApprovalChallenge({
      campaignId: envelope.campaignId,
      digest: envelope.digest,
      ttlMs: 60_000,
    });
    await consumeApprovalToken({
      store,
      token: challenge.token,
      campaignId: envelope.campaignId,
      digest: envelope.digest,
      operator: { kind: "configured-profile", id: "bounded-campaign-test" },
    });

    const runtime = await createCampaignRuntime(envelope, root, { mode: "real", configDir, stateDir });
    const showBeforeClaim = await source.execute({
      schemaVersion: 1,
      operation: "show",
      taskId: BOUNDED_TASK_ID,
      input: {},
    });
    if (!showBeforeClaim.ok || !showBeforeClaim.nativeRevision) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Cannot show bounded task before claim");
    }

    await mutateAcknowledged({
      campaignId: envelope.campaignId,
      outbox,
      source,
      request: {
        schemaVersion: 1,
        operation: "claim",
        taskId: BOUNDED_TASK_ID,
        expectedNativeRevision: showBeforeClaim.nativeRevision,
        idempotencyKey: `${envelope.campaignId}:${BOUNDED_TASK_ID}:claim:1`,
        input: {
          campaignId: envelope.campaignId,
          owner: "bounded-campaign",
          claimedAt: new Date().toISOString(),
        },
      },
    });

    const worktree = await runtime.worktree.prepareTaskWorktree(BOUNDED_TASK_ID, envelope.git.baseCommit);
    const briefPath = path.join(worktree.path, ".quirks-bounded-brief.md");
    await writeFile(briefPath, buildBrief(), "utf8");

    const implementerRoute = routeForTask(envelope, BOUNDED_TASK_ID, "implementer", runtime.profiles);
    const implementerJobId = `${envelope.campaignId}:${BOUNDED_TASK_ID}:implementer:1`;
    const implementerResult = await runtime.runner.dispatch({
      jobId: implementerJobId,
      taskId: BOUNDED_TASK_ID,
      role: "implementer",
      route: implementerRoute,
      briefPath,
      worktreePath: worktree.path,
    });
    if (implementerResult.status !== "success") {
      throw new QuirksError("PROTOCOL_VIOLATION", "Implementer runner failed");
    }

    const candidateCommit = await runtime.worktree.readCommit(worktree.path) ?? envelope.git.baseCommit;
    const changedFiles = await listChangedFiles(worktree.path, envelope.git.baseCommit, candidateCommit);
    if (changedFiles.join("\n") !== "src/message.txt") {
      throw new QuirksError("PROTOCOL_VIOLATION", "Implementer changed unexpected files");
    }

    await gitExec(root, ["checkout", envelope.git.campaignBranch]);
    await gitExec(root, ["merge", "--no-ff", worktree.branch, "-m", `Merge ${worktree.branch}`]);

    if (!isGitWorktreePort(runtime.worktree)) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Bounded campaign requires Git worktree support");
    }
    const reviewWorktree = await runtime.worktree.prepareReviewWorktree(BOUNDED_TASK_ID, candidateCommit);
    const reviewerRoute = routeForTask(envelope, BOUNDED_TASK_ID, "reviewer", runtime.profiles);
    const reviewerJobId = `${envelope.campaignId}:${BOUNDED_TASK_ID}:reviewer:1`;
    const reviewerResult = await runtime.runner.dispatch({
      jobId: reviewerJobId,
      taskId: BOUNDED_TASK_ID,
      role: "reviewer",
      route: reviewerRoute,
      briefPath,
      worktreePath: reviewWorktree.path,
    });
    if (reviewerResult.status !== "success") {
      throw new QuirksError("PROTOCOL_VIOLATION", "Reviewer runner failed");
    }

    const sessions = await SessionRegistry.open(store);
    await sessions.register({
      jobId: implementerJobId,
      role: "implementer",
      profileId: implementerRoute.profileId,
      sessionHandle: implementerResult.sessionHandle,
      pid: process.pid,
      artifactPaths: [...implementerResult.artifactPaths],
    });
    await sessions.register({
      jobId: reviewerJobId,
      role: "reviewer",
      profileId: reviewerRoute.profileId,
      sessionHandle: reviewerResult.sessionHandle,
      pid: process.pid,
      artifactPaths: [...reviewerResult.artifactPaths],
    });

    const showClaimed = await source.execute({
      schemaVersion: 1,
      operation: "show",
      taskId: BOUNDED_TASK_ID,
      input: {},
    });
    if (!showClaimed.ok || !showClaimed.nativeRevision) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Cannot show bounded task after implementer");
    }

    const claimedRevision = showClaimed.nativeRevision;
    await mutateAcknowledged({
      campaignId: envelope.campaignId,
      outbox,
      source,
      request: {
        schemaVersion: 1,
        operation: "submit-review",
        taskId: BOUNDED_TASK_ID,
        expectedNativeRevision: claimedRevision,
        idempotencyKey: `${envelope.campaignId}:${BOUNDED_TASK_ID}:submit-review:1`,
        input: { evidenceRefs: [`review:${BOUNDED_REVIEW_PATH}`] },
      },
    });

    const targetCommitBefore = await gitExec(root, ["rev-parse", envelope.git.targetBranch]);
    await syncTaskLedgerCommit(root);
    const landing = await mergeCampaignToTarget({
      repositoryRoot: root,
      git: {
        campaignBranch: envelope.git.campaignBranch,
        targetBranch: envelope.git.targetBranch,
        expectedTargetCommit: targetCommitBefore,
        push: {
          enabled: true,
          remote: remoteInfo.remoteName,
          branch,
        },
      },
      approvedPush: { remote: remoteInfo.remoteName, branch },
    });

    const showInReview = await source.execute({
      schemaVersion: 1,
      operation: "show",
      taskId: BOUNDED_TASK_ID,
      input: {},
    });
    if (!showInReview.ok || !showInReview.nativeRevision) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Cannot show bounded task before provenance");
    }

    const iterationId = `${envelope.campaignId}-landing`;
    await mutateAcknowledged({
      campaignId: envelope.campaignId,
      outbox,
      source,
      request: {
        schemaVersion: 1,
        operation: "attach-provenance",
        taskId: BOUNDED_TASK_ID,
        expectedNativeRevision: showInReview.nativeRevision,
        idempotencyKey: `${envelope.campaignId}:${BOUNDED_TASK_ID}:attach-provenance:1`,
        input: {
          iteration: {
            id: iterationId,
            outcome: "completed",
            completionBoundary: "remote-push",
            campaignId: envelope.campaignId,
            acceptedCommit: landing.mergeCommit,
            landedCommit: landing.mergeCommit,
            commitRefs: [candidateCommit, landing.mergeCommit],
            artifactRefs: [{ kind: "review", path: BOUNDED_REVIEW_PATH, commit: landing.mergeCommit }],
            verificationRefs: [{ kind: "verification", reference: "bounded-campaign-verification", outcome: "passed" }],
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            outcomeReason: "Bounded campaign review approved",
          },
        },
      },
    });

    const showAfterAttach = await source.execute({
      schemaVersion: 1,
      operation: "show",
      taskId: BOUNDED_TASK_ID,
      input: {},
    });
    if (!showAfterAttach.ok || !showAfterAttach.nativeRevision) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Cannot show bounded task after attach-provenance");
    }

    await mutateAcknowledged({
      campaignId: envelope.campaignId,
      outbox,
      source,
      request: {
        schemaVersion: 1,
        operation: "complete",
        taskId: BOUNDED_TASK_ID,
        expectedNativeRevision: showAfterAttach.nativeRevision,
        idempotencyKey: `${envelope.campaignId}:${BOUNDED_TASK_ID}:complete:1`,
        input: {
          evidenceRefs: [
            `commit:${landing.mergeCommit}`,
            `review:${BOUNDED_REVIEW_PATH}`,
            `verification:bounded-campaign-verification`,
          ],
        },
      },
    });

    const completed = await source.execute({
      schemaVersion: 1,
      operation: "show",
      taskId: BOUNDED_TASK_ID,
      input: {},
    });
    if (!completed.ok) {
      throw new QuirksError("PROTOCOL_VIOLATION", "Cannot show completed bounded task");
    }

    const pendingSyncIntents = (await outbox.listPending(envelope.campaignId)).length;
    const remoteHeadCommit = await remoteHead(remoteInfo.bareRemote, branch);

    await store.writeState({
      schemaVersion: 1,
      campaignId: envelope.campaignId,
      status: "complete",
      digest: envelope.digest,
      updatedAt: new Date().toISOString(),
      activeLanes: [],
    });

    await disposeTaskSource(source);

    return {
      campaignId: envelope.campaignId,
      taskId: BOUNDED_TASK_ID,
      taskStatus: (completed.data as { status: string }).status,
      changedFiles,
      acceptedCommit: landing.mergeCommit,
      remoteHead: remoteHeadCommit,
      review: { outcome: "approved" },
      pendingSyncIntents,
      approvalMethod: "headless consumeApprovalToken (createApprovalChallenge)",
      elapsedMs: Date.now() - started,
    };
  } finally {
    if (previousStateDir === undefined) delete process.env.QUIRKS_STATE_DIR;
    else process.env.QUIRKS_STATE_DIR = previousStateDir;
    if (previousConfigDir === undefined) delete process.env.QUIRKS_CONFIG_DIR;
    else process.env.QUIRKS_CONFIG_DIR = previousConfigDir;
    delete process.env.QUIRKS_BOUNDED_APPROVED_MESSAGE;
    delete process.env.QUIRKS_BOUNDED_REVIEW_PATH;
  }
}

export function redactBoundedCampaignEvidence(result: BoundedCampaignResult): Record<string, string> {
  return {
    campaignId: result.campaignId,
    taskId: result.taskId,
    taskStatus: result.taskStatus,
    changedFiles: result.changedFiles.join(","),
    acceptedCommit: result.acceptedCommit,
    remoteHead: result.remoteHead,
    reviewOutcome: result.review.outcome,
    pendingSyncIntents: String(result.pendingSyncIntents),
    approvalMethod: result.approvalMethod,
    elapsedMs: String(result.elapsedMs),
  };
}
