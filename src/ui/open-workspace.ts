import { execFile } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { CampaignStatus } from "../campaign/types.js";
import { QuirksError } from "../core/errors.js";
import { loadProjectContext } from "../project/config.js";
import type { ProjectContext } from "../project/types.js";
import { buildTaskHistory } from "../provenance/read-model.js";
import type { TaskProvenance } from "../provenance/types.js";
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
import type { ViewerSessionPort } from "./ports/viewer-session.js";
import { buildPlanProgressProjection } from "./read-models/plan-progress.js";
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
  const approval = createInMemoryApprovalPort(new InMemoryApprovalTokenStore());
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

async function listStoredCampaigns(stateDir: string): Promise<StoredCampaignFiles[]> {
  const reposRoot = path.join(stateDir, "repositories");
  let repoDirs: string[];
  try {
    repoDirs = await readdir(reposRoot);
  } catch {
    return [];
  }
  const stored: StoredCampaignFiles[] = [];
  for (const repoDir of repoDirs) {
    const campaignsRoot = path.join(reposRoot, repoDir, "campaigns");
    let campaignDirs: string[];
    try {
      campaignDirs = await readdir(campaignsRoot);
    } catch {
      continue;
    }
    for (const campaignId of campaignDirs) {
      const record = await readStoredCampaign(path.join(campaignsRoot, campaignId), campaignId);
      if (record) stored.push(record);
    }
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

async function resolveLedgerTask(
  getProjectContext: () => Promise<ProjectContext>,
  taskId: string,
): Promise<{ title: string; status: string; provenance: TaskProvenance } | undefined> {
  const context = await getProjectContext();
  return withTaskSource(context, async (source) => {
    const response = await source.execute({ schemaVersion: 1, operation: "show", taskId, input: {} });
    if (!response.ok) return undefined;
    const task = response.data as { title?: string; status?: string; provenance?: TaskProvenance };
    return {
      title: typeof task.title === "string" ? task.title : taskId,
      status: typeof task.status === "string" ? task.status : "unknown",
      provenance: task.provenance ?? { schemaVersion: 1, iterations: [] },
    };
  });
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

function createStoredCampaignReadPort(
  stateDir: string,
  getProjectContext: () => Promise<ProjectContext>,
  getNow: () => string,
): CampaignReadPort {
  const findCampaign = async (campaignId: string): Promise<StoredCampaignFiles> => {
    const stored = await listStoredCampaigns(stateDir);
    const record = stored.find((entry) => entry.campaign.campaignId === campaignId);
    if (!record) throw new QuirksError("PROTOCOL_VIOLATION", `Campaign ${campaignId} was not found`);
    return record;
  };
  return {
    listSummaries: async (input) => {
      const stored = await listStoredCampaigns(stateDir);
      return stored
        .map(toSummary)
        .filter((item) => !input.repositoryId || item.repositoryId === input.repositoryId)
        .toSorted((left, right) => left.campaignId.localeCompare(right.campaignId));
    },
    getDetail: async (campaignId) => {
      const record = await findCampaign(campaignId);
      const taskIds = record.campaign.taskIds ?? [];
      const tasks: UiCampaignTask[] = [];
      for (const taskId of taskIds) {
        const resolved = await resolveLedgerTask(getProjectContext, taskId);
        tasks.push({ taskId, title: resolved?.title ?? taskId, status: resolved?.status ?? "unknown" });
      }
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
      return buildPlanProgressProjection({ campaignId, taskId, refreshedAt: getNow() });
    },
  };
}

function createLedgerTaskHistorySource(
  repositoryRoot: string,
  getProjectContext: () => Promise<ProjectContext>,
): TaskHistorySource {
  return {
    getHistory: async (taskId) => {
      const resolved = await resolveLedgerTask(getProjectContext, taskId);
      if (!resolved) throw new QuirksError("PROTOCOL_VIOLATION", `Unknown task ${taskId}`);
      return buildTaskHistory({
        repositoryRoot,
        taskId,
        sourceProvenance: resolved.provenance,
      });
    },
  };
}

export type StandaloneWorkspacePorts = {
  getProjectContext: () => Promise<ProjectContext>;
  campaignRead: CampaignReadPort;
  taskHistory: TaskHistorySource;
};

export function createStandaloneWorkspacePorts(options: {
  repositoryRoot: string;
  stateDir: string;
  now?: () => string;
}): StandaloneWorkspacePorts {
  const getNow = options.now ?? (() => new Date().toISOString());
  const getProjectContext = () => loadProjectContext(options.repositoryRoot, { mode: "inspection" });
  return {
    getProjectContext,
    campaignRead: createStoredCampaignReadPort(options.stateDir, getProjectContext, getNow),
    taskHistory: createLedgerTaskHistorySource(options.repositoryRoot, getProjectContext),
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
  let repositoryId: string;
  let campaign: ResolvedCampaign | undefined;
  let standalonePorts: StandaloneWorkspacePorts | undefined;
  if (input.campaignId === undefined) {
    const repositoryRoot = input.repositoryRoot ?? process.cwd();
    const context = await loadProjectContext(repositoryRoot, { mode: "inspection" });
    repositoryId = context.repositoryId;
    standalonePorts = createStandaloneWorkspacePorts({
      repositoryRoot,
      stateDir,
      ...(input.deps?.now ? { now: input.deps.now } : {}),
    });
  } else {
    campaign = await ports.resolveCampaign(input.campaignId);
    if (!campaign) {
      throw new QuirksError("PROTOCOL_VIOLATION", `Campaign ${input.campaignId} was not found`);
    }
    repositoryId = campaign.repositoryId;
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
      ? [[input.campaignId, { repositoryId: campaign.repositoryId, envelopeDigest: campaign.envelopeDigest }]]
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
