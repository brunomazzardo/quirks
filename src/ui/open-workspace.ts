import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { hasDurableApproval } from "../campaign/approval.js";
import { CampaignStore } from "../campaign/store.js";
import type { CampaignEnvelope, CampaignStatus } from "../campaign/types.js";
import { QuirksError } from "../core/errors.js";
import { loadProjectContext } from "../project/config.js";
import type { ProjectContext } from "../project/types.js";
import { buildTaskHistory } from "../provenance/read-model.js";
import type { TaskProvenance } from "../provenance/types.js";
import { validateSchema } from "../schema/validate.js";
import { resolveAppPaths } from "../state/app-paths.js";
import { SyncOutbox } from "../sync/outbox.js";
import { createTaskSource } from "../task-source/factory.js";
import { disposeTaskSource, type TaskSource } from "../task-source/task-source.js";
import type { TaskHistorySource } from "./api/task-history.js";
import { InMemoryApprovalTokenStore } from "./approval/token-store.js";
import { createLoopbackAuthority } from "./authority.js";
import { InMemoryViewerSessionStore } from "./auth/viewer-session-store.js";
import type { ApprovalWritePort } from "./ports/approval-write.js";
import type { CampaignReadPort, UiCampaignDetail, UiCampaignSummaryItem, UiCampaignTask } from "./ports/campaign-read.js";
import type { PreflightReadPort } from "./ports/preflight-read.js";
import {
  createPromptReadPort,
  type CampaignPromptFacts,
  type PromptReadPort,
} from "./ports/prompt-read.js";
import type { ViewerSessionPort } from "./ports/viewer-session.js";
import type { UiPreflightProposalV1 } from "./types/preflight-proposal.js";
import { loadClientBundle } from "./shell.js";
import { createUiServer } from "./server.js";
import { type CampaignRecord, type UiRouterOptions } from "./router.js";

function createInMemoryApprovalPort(
  store: InMemoryApprovalTokenStore,
  getNow: () => string = () => new Date().toISOString(),
): ApprovalWritePort {
  let eventCounter = 0;
  return {
    issueToken: (input) => store.issue({ ...input, now: input.now ?? getNow() }),
    approve: async (input) => {
      const result = await store.consume({
        campaignId: input.campaignId,
        envelopeDigest: input.envelopeDigest,
        approvalToken: input.approvalToken,
        now: getNow(),
      });
      if (result !== "ok") return { result };
      eventCounter += 1;
      return { result: "approved", approvalEventId: `approval-${eventCounter}` };
    },
  };
}

const execFileAsync = promisify(execFile);

export type ResolvedCampaign = {
  repositoryId: string;
  envelopeDigest: string;
  status: CampaignStatus;
};

export type WorkspacePorts = {
  viewerSession: ViewerSessionPort;
  approval: ApprovalWritePort;
  resolveCampaign: (campaignId: string) => Promise<ResolvedCampaign | undefined>;
};

export type OpenWorkspaceDeps = {
  json?: boolean;
  isTty?: boolean;
  openBrowser?: (url: string) => Promise<void>;
  now?: () => string;
};

export type OpenWorkspaceInput = {
  campaignId?: string;
  repositoryRoot?: string;
  ports?: "fake" | "production" | WorkspacePorts;
  fakeCampaigns?: Record<string, ResolvedCampaign>;
  stateDir?: string;
  deps?: OpenWorkspaceDeps;
  keepAlive?: boolean;
};

export type OpenWorkspaceResult = {
  ok: true;
  authority: string;
  repositoryId: string;
  campaignId?: string;
  readOnly: boolean;
  viewerIdleExpiresAt: string;
  viewerAbsoluteExpiresAt: string;
  approvalExpiresAt?: string;
  launchUrl: string;
  requiresInteractiveRerun: boolean;
  close?: () => Promise<void>;
};

function defaultStateDir(): string {
  return resolveAppPaths("placeholder").root;
}

function shellRouteFor(status: CampaignStatus, campaignId: string): string {
  return status === "awaiting_approval" ? `/preflight/${campaignId}` : `/campaigns/${campaignId}`;
}

function buildLaunchUrl(authority: string, route: string, viewerToken: string, approvalToken?: string): string {
  const fragment = approvalToken
    ? `viewToken=${encodeURIComponent(viewerToken)}&approvalToken=${encodeURIComponent(approvalToken)}`
    : `viewToken=${encodeURIComponent(viewerToken)}`;
  return `${authority}${route}#${fragment}`;
}

async function resolveCampaignFromState(stateDir: string, campaignId: string): Promise<ResolvedCampaign | undefined> {
  const reposRoot = path.join(stateDir, "repositories");
  let repoDirs: string[];
  try {
    repoDirs = await readdir(reposRoot);
  } catch {
    return undefined;
  }
  for (const repoDir of repoDirs) {
    const campaignDir = path.join(reposRoot, repoDir, "campaigns", campaignId);
    try {
      const state = JSON.parse(await readFile(path.join(campaignDir, "state.json"), "utf8")) as {
        campaignId: string;
        digest: string;
        status: CampaignStatus;
      };
      const envelope = JSON.parse(await readFile(path.join(campaignDir, "campaign.json"), "utf8")) as {
        repositoryId: string;
      };
      if (state.campaignId !== campaignId) continue;
      return { repositoryId: envelope.repositoryId, envelopeDigest: state.digest, status: state.status };
    } catch {
      continue;
    }
  }
  return undefined;
}

export function createFakeWorkspacePorts(
  campaigns: Record<string, ResolvedCampaign> = {
    "C-1": { repositoryId: "repo-1", envelopeDigest: "sha256:abc", status: "awaiting_approval" },
  },
): WorkspacePorts {
  const viewerSession = new InMemoryViewerSessionStore();
  const approval = createInMemoryApprovalPort(new InMemoryApprovalTokenStore());
  const records = new Map(Object.entries(campaigns));
  return {
    viewerSession,
    approval,
    resolveCampaign: async (campaignId) => records.get(campaignId),
  };
}

async function createProductionPorts(stateDir: string): Promise<WorkspacePorts> {
  const viewerSession = new InMemoryViewerSessionStore();
  // Production approvals must survive the workspace process: the durable port
  // records consumed approvals in the campaign's approvals.jsonl.
  const approval = createDurableApprovalWritePort(stateDir);
  return {
    viewerSession,
    approval,
    resolveCampaign: (campaignId) => resolveCampaignFromState(stateDir, campaignId),
  };
}

async function resolvePorts(input: OpenWorkspaceInput, stateDir: string): Promise<WorkspacePorts> {
  const mode = input.ports ?? "production";
  if (mode === "production") return createProductionPorts(stateDir);
  if (mode !== "fake") return mode;
  if (!input.fakeCampaigns) return createFakeWorkspacePorts();
  return createFakeWorkspacePorts({
    "C-1": { repositoryId: "repo-1", envelopeDigest: "sha256:abc", status: "awaiting_approval" },
    ...input.fakeCampaigns,
  });
}

type StoredCampaignFiles = {
  campaign: { campaignId: string; repositoryId: string; createdAt?: string; taskIds?: string[] };
  state: { status: CampaignStatus; updatedAt?: string; spend?: Record<string, number> };
  campaignDir: string;
};

async function readStoredCampaign(campaignDir: string, campaignId: string): Promise<StoredCampaignFiles | undefined> {
  try {
    const campaign = JSON.parse(await readFile(path.join(campaignDir, "campaign.json"), "utf8")) as StoredCampaignFiles["campaign"];
    const state = JSON.parse(await readFile(path.join(campaignDir, "state.json"), "utf8")) as StoredCampaignFiles["state"];
    if (campaign.campaignId !== campaignId) return undefined;
    return { campaign, state, campaignDir };
  } catch {
    return undefined;
  }
}

function toSummary(record: StoredCampaignFiles): UiCampaignSummaryItem {
  return {
    campaignId: record.campaign.campaignId,
    repositoryId: record.campaign.repositoryId,
    state: record.state.status,
    taskCount: record.campaign.taskIds?.length ?? 0,
    ...(record.campaign.createdAt ? { startedAt: record.campaign.createdAt } : {}),
    ...(record.state.spend ? { spend: record.state.spend } : {}),
  };
}

async function readCampaignSyncCounters(campaignDir: string): Promise<{ pending: number; conflicts: number }> {
  try {
    const intents = await SyncOutbox.open(path.join(campaignDir, "sync-outbox.jsonl")).listAll();
    return {
      pending: intents.filter((intent) => intent.state === "pending").length,
      conflicts: intents.filter((intent) => intent.state === "conflict").length,
    };
  } catch {
    return { pending: 0, conflicts: 0 };
  }
}

const warnedInvalidCampaignDirs = new Set<string>();

function isValidStoredCampaign(record: StoredCampaignFiles): boolean {
  try {
    validateSchema("ui-campaign-summary-v1", { schemaVersion: 1, items: [toSummary(record)] });
    return true;
  } catch {
    if (!warnedInvalidCampaignDirs.has(record.campaignDir)) {
      warnedInvalidCampaignDirs.add(record.campaignDir);
      process.emitWarning(`Skipping invalid campaign record at ${record.campaignDir}`);
    }
    return false;
  }
}

// Lists only campaigns that belong to the workspace's own repository. The bound
// repository id is enforced server-side so a viewer session can never enumerate
// another repository's campaigns, and records that fail projection validation
// are skipped instead of failing the whole listing.
async function listRepositoryCampaigns(stateDir: string, repositoryId: string): Promise<StoredCampaignFiles[]> {
  const campaignsRoot = path.join(stateDir, "repositories", repositoryId.replaceAll(":", "-"), "campaigns");
  let campaignDirs: string[];
  try {
    campaignDirs = await readdir(campaignsRoot);
  } catch {
    return [];
  }
  const stored: StoredCampaignFiles[] = [];
  for (const campaignId of campaignDirs) {
    const record = await readStoredCampaign(path.join(campaignsRoot, campaignId), campaignId);
    if (!record) continue;
    if (record.campaign.repositoryId !== repositoryId) continue;
    if (!isValidStoredCampaign(record)) continue;
    stored.push(record);
  }
  return stored;
}

async function withTaskSource<T>(context: ProjectContext, callback: (source: TaskSource) => Promise<T>): Promise<T> {
  const source = await createTaskSource(context);
  try {
    return await callback(source);
  } finally {
    await disposeTaskSource(source);
  }
}

async function showLedgerTask(
  source: TaskSource,
  taskId: string,
): Promise<{ title: string; status: string; provenance: TaskProvenance } | undefined> {
  const response = await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
  if (!response.ok) return undefined;
  const task = response.data as { title?: string; status?: string; provenance?: TaskProvenance };
  return {
    title: typeof task.title === "string" ? task.title : taskId,
    status: typeof task.status === "string" ? task.status : "unknown",
    provenance: task.provenance ?? { schemaVersion: 1, iterations: [] },
  };
}

function createStoredCampaignReadPort(
  stateDir: string,
  getProjectContext: () => Promise<ProjectContext>,
): CampaignReadPort {
  const boundCampaigns = async (): Promise<{ context: ProjectContext; records: StoredCampaignFiles[] }> => {
    const context = await getProjectContext();
    return { context, records: await listRepositoryCampaigns(stateDir, context.repositoryId) };
  };
  const findCampaign = async (
    campaignId: string,
  ): Promise<{ context: ProjectContext; record: StoredCampaignFiles }> => {
    const { context, records } = await boundCampaigns();
    const record = records.find((entry) => entry.campaign.campaignId === campaignId);
    if (!record) throw new QuirksError("PROTOCOL_VIOLATION", `Campaign ${campaignId} was not found`);
    return { context, record };
  };
  return {
    listSummaries: async (input) => {
      const { context, records } = await boundCampaigns();
      if (input.repositoryId !== undefined && input.repositoryId !== context.repositoryId) return [];
      return records
        .map(toSummary)
        .toSorted((left, right) => left.campaignId.localeCompare(right.campaignId));
    },
    getDetail: async (campaignId) => {
      const { context, record } = await findCampaign(campaignId);
      const taskIds = record.campaign.taskIds ?? [];
      const tasks = await withTaskSource(context, async (source) => {
        const resolved: UiCampaignTask[] = [];
        for (const taskId of taskIds) {
          const shown = await showLedgerTask(source, taskId);
          resolved.push({ taskId, title: shown?.title ?? taskId, status: shown?.status ?? "unknown" });
        }
        return resolved;
      });
      const detail: UiCampaignDetail = {
        ...toSummary(record),
        tasks,
        waves: [],
        runners: [],
        commits: [],
        pullRequests: [],
        verification: [],
        sync: await readCampaignSyncCounters(record.campaignDir),
      };
      return detail;
    },
    getPlanProgress: async ({ taskId, campaignId }) => {
      await findCampaign(campaignId);
      // Plan progress is derived only from a controller journal. The standalone
      // workspace does not replay historical progress journals yet, so report
      // the projection as unavailable instead of fabricating plan data.
      throw new QuirksError(
        "PROTOCOL_VIOLATION",
        `No recorded plan progress for task ${taskId} in campaign ${campaignId}`,
      );
    },
  };
}

function createLedgerTaskHistorySource(
  repositoryRoot: string,
  getProjectContext: () => Promise<ProjectContext>,
): TaskHistorySource {
  return {
    getHistory: async (taskId) => {
      const context = await getProjectContext();
      const resolved = await withTaskSource(context, (source) => showLedgerTask(source, taskId));
      if (!resolved) throw new QuirksError("PROTOCOL_VIOLATION", `Unknown task ${taskId}`);
      return buildTaskHistory({
        repositoryRoot,
        taskId,
        sourceProvenance: resolved.provenance,
      });
    },
  };
}

async function readStoredCampaignPromptFacts(
  stateDir: string,
  repositoryId: string,
  campaignId: string | undefined,
): Promise<CampaignPromptFacts | undefined> {
  if (campaignId === undefined) return undefined;
  const campaignDir = path.join(
    stateDir,
    "repositories",
    repositoryId.replaceAll(":", "-"),
    "campaigns",
    campaignId,
  );
  const record = await readStoredCampaign(campaignDir, campaignId);
  if (!record || record.campaign.repositoryId !== repositoryId) return undefined;
  const state = record.state as { status: CampaignStatus; digest?: string };
  const envelope = record.campaign as { git?: { baseCommit?: string } };
  const digest = typeof state.digest === "string" ? state.digest : undefined;
  if (digest === undefined) return undefined;

  // Approval is durable evidence, never inferred: only a recorded approval
  // bound to the current envelope digest counts.
  let approved = false;
  try {
    const raw = await readFile(path.join(campaignDir, "approvals.jsonl"), "utf8");
    approved = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .some((line) => {
        try {
          const entry = JSON.parse(line) as { digest?: string };
          return entry.digest === digest;
        } catch {
          return false;
        }
      });
  } catch {
    approved = false;
  }

  return {
    campaignId,
    state: state.status,
    approved,
    envelopeDigest: digest,
    ...(typeof envelope.git?.baseCommit === "string" ? { baseCommit: envelope.git.baseCommit } : {}),
  };
}

/**
 * Production prompt read port for `ui open`: assembles prompt contexts from
 * the real TaskSource and durable stored campaign state. Serves both the
 * campaign-bound and the standalone read-only workspace; recommendations stay
 * state-valid because approval is read from durable records only.
 */
export function createWorkspacePromptReadPort(options: {
  repositoryRoot: string;
  stateDir: string;
  getProjectContext: () => Promise<ProjectContext>;
}): PromptReadPort {
  return {
    async getContext(request) {
      const context = await options.getProjectContext();
      return withTaskSource(context, async (source) => {
        const port = createPromptReadPort({
          repositoryId: context.repositoryId,
          repositoryRoot: options.repositoryRoot,
          source,
          skills: context.config.workflowPolicy.skills,
          // Approved runner routes are campaign-envelope facts; the workspace
          // has none of its own, and absent routes stay absent (visible
          // independence warnings instead of invented profiles).
          profiles: [],
          campaign: (campaignId) =>
            readStoredCampaignPromptFacts(options.stateDir, context.repositoryId, campaignId),
        });
        return port.getContext(request);
      });
    },
  };
}

const PROPOSAL_TITLE_MAX_LENGTH = 256;

function clampProposalTitle(title: string): string {
  return title.length > PROPOSAL_TITLE_MAX_LENGTH ? title.slice(0, PROPOSAL_TITLE_MAX_LENGTH) : title;
}

async function openScopedCampaignStore(
  stateDir: string,
  repositoryId: string,
  campaignId: string,
): Promise<CampaignStore> {
  // CampaignStore.open validates the envelope schema, the identity binding, and
  // the recomputed envelope digest, and its path is scoped to the workspace's
  // own repository — another repository's campaigns are unreachable by design.
  try {
    return await CampaignStore.open(stateDir, repositoryId, campaignId);
  } catch {
    throw new QuirksError("PROTOCOL_VIOLATION", `Campaign ${campaignId} has no durable envelope`);
  }
}

/**
 * Builds the preflight proposal projection from durable campaign state only:
 * campaign.json (envelope), state.json, and approvals.jsonl, plus task titles
 * from the real task ledger. Scheduling projections (waves, lanes, estimates,
 * confidence, inspector rationale) are recomputed at execution time and are
 * NOT persisted in the envelope, so they are reported as explicitly
 * unavailable — never fabricated.
 */
function buildDurablePreflightProposal(options: {
  campaignId: string;
  envelope: CampaignEnvelope;
  approvedDigestRecorded: boolean;
  titles: ReadonlyMap<string, string>;
}): UiPreflightProposalV1 {
  const { campaignId, envelope } = options;
  const tasks = envelope.taskIds.map((taskId) => {
    const routing = envelope.routing[taskId];
    if (!routing) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Campaign ${campaignId} envelope has no routing for task ${taskId}`);
    }
    const fallback = routing.fallbacks[0];
    return {
      taskId,
      title: clampProposalTitle(options.titles.get(taskId) ?? taskId),
      waveId: null,
      laneId: null,
      route: {
        profileId: routing.primary.profileId,
        tier: routing.primary.tier,
        effort: routing.primary.effort,
      },
      fallback: fallback
        ? { profileId: fallback.profileId, tier: fallback.tier, effort: fallback.effort }
        : null,
      confidence: "unavailable" as const,
    };
  });
  const humanGates = envelope.taskIds
    .filter((taskId) => envelope.designModes[taskId]?.mode === "human")
    .map((taskId) => `Human design approval required for task ${taskId}`);
  return {
    schemaVersion: 1,
    campaignId,
    state: "awaiting_approval",
    envelopeDigest: envelope.digest,
    summary: {
      taskCount: envelope.taskIds.length,
      waveCount: null,
      estimatedMinutes: null,
      confidence: "unavailable",
      budget: {
        maxWallClockMs: envelope.budgets.maxWallClockMs,
        maxConcurrency: envelope.budgets.maxConcurrency,
      },
      landing: {
        baseCommit: envelope.git.baseCommit,
        campaignBranch: envelope.git.campaignBranch,
        targetBranch: envelope.git.targetBranch,
      },
      push: {
        enabled: envelope.git.push.enabled,
        remote: envelope.git.push.remote ?? null,
        branch: envelope.git.push.branch ?? null,
      },
    },
    waves: [],
    lanes: [],
    tasks,
    inspector: null,
    residuals: [
      "Wave, lane, schedule, and confidence projections are recomputed at execution time and are not persisted in the campaign envelope",
      ...(options.approvedDigestRecorded
        ? ["A durable approval is already recorded for this envelope digest"]
        : []),
    ],
    humanGates,
    unsupportedCapabilities: [
      ...(envelope.git.push.enabled ? [] : ["remote-git-push"]),
      ...(envelope.externalRoutingEnabled ? [] : ["external-routing"]),
    ],
    approval: { campaignId, envelopeDigest: envelope.digest },
  };
}

/**
 * Production preflight read port for `ui open`: serves the proposal for an
 * awaiting_approval campaign from durable state only (campaign.json envelope,
 * state.json status, approvals.jsonl), following the same durable-state
 * pattern as createWorkspacePromptReadPort. Task titles come from the real
 * task ledger; a missing ledger degrades to task ids, never invented titles.
 */
export function createDurablePreflightReadPort(options: {
  stateDir: string;
  getProjectContext: () => Promise<ProjectContext>;
  repositoryId?: string;
}): PreflightReadPort {
  const boundRepositoryId = async (): Promise<string> =>
    options.repositoryId ?? (await options.getProjectContext()).repositoryId;
  const resolveLedgerTitles = async (
    repositoryId: string,
    taskIds: readonly string[],
  ): Promise<Map<string, string>> => {
    const titles = new Map<string, string>();
    try {
      const context = await options.getProjectContext();
      if (context.repositoryId !== repositoryId) return titles;
      await withTaskSource(context, async (source) => {
        for (const taskId of taskIds) {
          const shown = await showLedgerTask(source, taskId);
          if (shown) titles.set(taskId, shown.title);
        }
      });
    } catch {
      // Ledger unavailable: fall back to task ids rather than invented titles.
    }
    return titles;
  };
  return {
    getProposal: async (campaignId) => {
      const repositoryId = await boundRepositoryId();
      const store = await openScopedCampaignStore(options.stateDir, repositoryId, campaignId);
      const envelope = await store.readEnvelope();
      const state = await store.readState();
      if (state.status !== "awaiting_approval") {
        throw new QuirksError("PROTOCOL_VIOLATION", `Campaign ${campaignId} is not awaiting approval`);
      }
      if (state.digest !== envelope.digest) {
        throw new QuirksError("PROTOCOL_VIOLATION", `Campaign ${campaignId} state digest does not match its envelope`);
      }
      const approvedDigestRecorded = await hasDurableApproval(store, envelope.digest);
      const titles = await resolveLedgerTitles(repositoryId, envelope.taskIds);
      return buildDurablePreflightProposal({ campaignId, envelope, approvedDigestRecorded, titles });
    },
  };
}

/**
 * Production approval write port for `ui open`: token lifecycle stays
 * in-memory (approval tokens are ephemeral, session-scoped credentials), but a
 * consumed approval is recorded durably in the campaign's approvals.jsonl and
 * events.jsonl so `quirks-campaign start` can honor it after the workspace
 * closes. Mirrors the digest and replay checks of consumeApprovalToken.
 */
export function createDurableApprovalWritePort(
  stateDir: string,
  getNow: () => string = () => new Date().toISOString(),
): ApprovalWritePort {
  const tokens = new InMemoryApprovalTokenStore();
  return {
    issueToken: (input) => tokens.issue({ ...input, now: input.now ?? getNow() }),
    approve: async (input) => {
      const consumed = await tokens.consume({
        campaignId: input.campaignId,
        envelopeDigest: input.envelopeDigest,
        approvalToken: input.approvalToken,
        now: getNow(),
      });
      if (consumed !== "ok") return { result: consumed };
      const resolved = await resolveCampaignFromState(stateDir, input.campaignId);
      if (!resolved) return { result: "invalid" };
      try {
        const store = await CampaignStore.open(stateDir, resolved.repositoryId, input.campaignId);
        const envelope = await store.readEnvelope();
        if (envelope.digest !== input.envelopeDigest) return { result: "stale" };
        if (await hasDurableApproval(store, envelope.digest)) return { result: "replay" };
        const tokenId = createHash("sha256").update(input.approvalToken).digest("hex");
        const approvedAt = getNow();
        await store.appendApproval({
          schemaVersion: 1,
          campaignId: input.campaignId,
          digest: envelope.digest,
          approvedAt,
          operator: { kind: "self-asserted", id: input.operator.label },
          tokenId,
          evidence: { channel: "loopback-ui", operator: input.operator.evidence },
        });
        await store.appendEvent({
          schemaVersion: 1,
          id: `approval:${tokenId}`,
          type: "approval.recorded",
          at: approvedAt,
          actor: input.operator.label,
          from: "awaiting_approval",
          to: "running",
          reason: "operator_approved",
          evidence: { digest: envelope.digest, tokenId },
        });
        return { result: "approved", approvalEventId: `approval:${tokenId}` };
      } catch {
        return { result: "invalid" };
      }
    },
  };
}

export type StandaloneWorkspacePorts = {
  getProjectContext: () => Promise<ProjectContext>;
  campaignRead: CampaignReadPort;
  taskHistory: TaskHistorySource;
  promptRead: PromptReadPort;
  preflightRead: PreflightReadPort;
};

export function createStandaloneWorkspacePorts(options: {
  repositoryRoot: string;
  stateDir: string;
}): StandaloneWorkspacePorts {
  const getProjectContext = () => loadProjectContext(options.repositoryRoot, { mode: "inspection" });
  return {
    getProjectContext,
    campaignRead: createStoredCampaignReadPort(options.stateDir, getProjectContext),
    taskHistory: createLedgerTaskHistorySource(options.repositoryRoot, getProjectContext),
    promptRead: createWorkspacePromptReadPort({
      repositoryRoot: options.repositoryRoot,
      stateDir: options.stateDir,
      getProjectContext,
    }),
    preflightRead: createDurablePreflightReadPort({
      stateDir: options.stateDir,
      getProjectContext,
    }),
  };
}

async function defaultOpenBrowser(url: string): Promise<void> {
  if (process.platform === "darwin") await execFileAsync("open", [url]);
  else if (process.platform === "linux") await execFileAsync("xdg-open", [url]);
  else if (process.platform === "win32") await execFileAsync("cmd", ["/c", "start", "", url]);
  else throw new QuirksError("PROTOCOL_VIOLATION", "Browser launch is unsupported on this platform");
}

export async function openWorkspace(input: OpenWorkspaceInput): Promise<OpenWorkspaceResult> {
  const stateDir = input.stateDir ?? process.env.QUIRKS_STATE_DIR ?? defaultStateDir();
  await mkdir(path.join(stateDir, "repositories"), { recursive: true });

  const ports = await resolvePorts(input, stateDir);
  const readOnly = input.campaignId === undefined;
  const repositoryRoot = input.repositoryRoot ?? process.cwd();
  let repositoryId: string;
  let campaign: ResolvedCampaign | undefined;
  let standalonePorts: StandaloneWorkspacePorts | undefined;
  let promptRead: PromptReadPort | undefined;
  let preflightRead: PreflightReadPort | undefined;
  if (input.campaignId === undefined) {
    const context = await loadProjectContext(repositoryRoot, { mode: "inspection" });
    repositoryId = context.repositoryId;
    standalonePorts = createStandaloneWorkspacePorts({ repositoryRoot, stateDir });
  } else {
    campaign = await ports.resolveCampaign(input.campaignId);
    if (!campaign) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Campaign ${input.campaignId} was not found`);
    }
    repositoryId = campaign.repositoryId;
    const getProjectContext = () => loadProjectContext(repositoryRoot, { mode: "inspection" });
    // Campaign-bound workspaces expose the same contextual copy prompts as
    // the standalone read-only mode, from the same durable state.
    promptRead = createWorkspacePromptReadPort({ repositoryRoot, stateDir, getProjectContext });
    // The preflight proposal view (the only place the approval form renders)
    // is served from the durable campaign store, bound to the campaign's own
    // repository id.
    preflightRead = createDurablePreflightReadPort({
      stateDir,
      getProjectContext,
      repositoryId: campaign.repositoryId,
    });
  }

  const getNow = input.deps?.now ?? (() => new Date().toISOString());
  const viewer = await ports.viewerSession.issue({ repositoryId, now: getNow() });
  let approvalExpiresAt: string | undefined;
  let approvalToken: string | undefined;
  if (input.campaignId !== undefined && campaign && campaign.status === "awaiting_approval") {
    const issued = await ports.approval.issueToken({
      campaignId: input.campaignId,
      envelopeDigest: campaign.envelopeDigest,
      now: getNow(),
    });
    approvalExpiresAt = issued.expiresAt;
    approvalToken = issued.approvalToken;
  }

  const authority = await createLoopbackAuthority();
  const clientScript = await loadClientBundle();
  const campaigns = new Map<string, CampaignRecord>(
    input.campaignId !== undefined && campaign
      ? [[
          input.campaignId,
          {
            repositoryId: campaign.repositoryId,
            envelopeDigest: campaign.envelopeDigest,
            status: campaign.status,
          },
        ]]
      : [],
  );
  const routerOptions: UiRouterOptions = {
    authority,
    repositoryId,
    viewerSession: ports.viewerSession,
    approval: ports.approval,
    getCampaign: (campaignId) => campaigns.get(campaignId),
    now: getNow,
    clientScript,
    ...(readOnly ? { readOnly: true } : {}),
    ...(promptRead ? { promptRead } : {}),
    ...(preflightRead ? { preflightRead } : {}),
    ...standalonePorts,
  };
  const server = await createUiServer(routerOptions);

  const launchUrl = buildLaunchUrl(
    authority.baseUrl,
    input.campaignId !== undefined && campaign ? shellRouteFor(campaign.status, input.campaignId) : "/",
    viewer.viewerToken,
    approvalToken,
  );
  const json = input.deps?.json ?? false;
  const isTty = input.deps?.isTty ?? false;
  const requiresInteractiveRerun = !json && !isTty;
  if (!json && isTty) {
    const openBrowser = input.deps?.openBrowser ?? defaultOpenBrowser;
    await openBrowser(launchUrl);
  }

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await server.close();
  };
  if (input.keepAlive === false) {
    await close();
  }

  return {
    ok: true,
    authority: authority.baseUrl,
    repositoryId,
    ...(input.campaignId !== undefined ? { campaignId: input.campaignId } : {}),
    readOnly,
    viewerIdleExpiresAt: viewer.idleExpiresAt,
    viewerAbsoluteExpiresAt: viewer.absoluteExpiresAt,
    ...(approvalExpiresAt ? { approvalExpiresAt } : {}),
    launchUrl,
    requiresInteractiveRerun,
    close,
  };
}
