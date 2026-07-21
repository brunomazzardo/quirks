import { execFile } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { CampaignStatus } from "../campaign/types.js";
import { QuirksError } from "../core/errors.js";
import { resolveAppPaths } from "../state/app-paths.js";
import { InMemoryApprovalTokenStore } from "./approval/token-store.js";
import { createLoopbackAuthority } from "./authority.js";
import { InMemoryViewerSessionStore } from "./auth/viewer-session-store.js";
import type { ApprovalWritePort } from "./ports/approval-write.js";
import type { ViewerSessionPort } from "./ports/viewer-session.js";
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
  campaignId: string;
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
  campaignId: string;
  viewerIdleExpiresAt: string;
  viewerAbsoluteExpiresAt: string;
  approvalExpiresAt?: string;
  launchUrl: string;
  requiresInteractiveRerun: boolean;
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
  const campaign = await ports.resolveCampaign(input.campaignId);
  if (!campaign) {
    throw new QuirksError("PROTOCOL_VIOLATION", `Campaign ${input.campaignId} was not found`);
  }

  const getNow = input.deps?.now ?? (() => new Date().toISOString());
  const viewer = await ports.viewerSession.issue({ repositoryId: campaign.repositoryId, now: getNow() });
  let approvalExpiresAt: string | undefined;
  let approvalToken: string | undefined;
  if (campaign.status === "awaiting_approval") {
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
  const campaigns = new Map<string, CampaignRecord>([
    [input.campaignId, { repositoryId: campaign.repositoryId, envelopeDigest: campaign.envelopeDigest }],
  ]);
  const routerOptions: UiRouterOptions = {
    authority,
    repositoryId: campaign.repositoryId,
    viewerSession: ports.viewerSession,
    approval: ports.approval,
    getCampaign: (campaignId) => campaigns.get(campaignId),
    now: getNow,
    clientScript,
  };
  const server = await createUiServer(routerOptions);

  const launchUrl = buildLaunchUrl(
    authority.baseUrl,
    shellRouteFor(campaign.status, input.campaignId),
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

  if (input.keepAlive === false) {
    await server.close();
  }

  return {
    ok: true,
    authority: authority.baseUrl,
    repositoryId: campaign.repositoryId,
    campaignId: input.campaignId,
    viewerIdleExpiresAt: viewer.idleExpiresAt,
    viewerAbsoluteExpiresAt: viewer.absoluteExpiresAt,
    ...(approvalExpiresAt ? { approvalExpiresAt } : {}),
    launchUrl,
    requiresInteractiveRerun,
  };
}
