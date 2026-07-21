import path from "node:path";
import type { CampaignStatus } from "../../../src/campaign/types.js";
import { loadProjectContext } from "../../../src/project/config.js";
import { createLoopbackAuthority } from "../../../src/ui/authority.js";
import { InMemoryApprovalTokenStore } from "../../../src/ui/approval/token-store.js";
import { InMemoryViewerSessionStore } from "../../../src/ui/auth/viewer-session-store.js";
import { loadClientBundle } from "../../../src/ui/shell.js";
import { createUiServer } from "../../../src/ui/server.js";
import { FakeApprovalWritePort } from "./fake-approval-write.js";
import { fakePreflightPort } from "./fake-preflight.js";

export type TestCampaign = { repositoryId: string; envelopeDigest: string; status?: CampaignStatus };

export type TestUiServer = {
  authority: Awaited<ReturnType<typeof createLoopbackAuthority>>;
  repositoryId: string;
  readPortCalls: number;
  approvePortCalls: number;
  setNow: (now: string) => void;
  issue: (campaignId: string, envelopeDigest: string) => Promise<{ viewerToken: string; approvalToken: string }>;
  close: () => Promise<void>;
};

export async function createTestUiServer(options?: {
  repositoryId?: string;
  campaigns?: Record<string, TestCampaign>;
  now?: string;
  clientScript?: string;
}): Promise<TestUiServer> {
  const authority = await createLoopbackAuthority();
  const repositoryId = options?.repositoryId ?? "repo-1";
  const campaigns = new Map(Object.entries(options?.campaigns ?? {}));
  let currentNow = options?.now ?? "2026-07-21T12:00:00.000Z";
  const getNow = () => currentNow;
  const viewerSession = new InMemoryViewerSessionStore();
  const approvalStore = new InMemoryApprovalTokenStore();
  const approval = new FakeApprovalWritePort(approvalStore, getNow);
  let readPortCalls = 0;
  let approvePortCalls = 0;
  const ensureCampaign = (campaignId: string, envelopeDigest: string) => {
    if (!campaigns.has(campaignId)) {
      campaigns.set(campaignId, { repositoryId, envelopeDigest, status: "awaiting_approval" });
    }
  };
  const projectRoot = path.resolve("test/fixtures/json-project");
  const clientScript = options?.clientScript ?? (await loadClientBundle());
  const server = await createUiServer({
    authority,
    repositoryId,
    viewerSession,
    approval,
    now: getNow,
    getCampaign: (campaignId) => campaigns.get(campaignId),
    getProjectContext: () => loadProjectContext(projectRoot, { mode: "inspection" }),
    preflightRead: fakePreflightPort(),
    clientScript,
    onRead: () => {
      readPortCalls += 1;
    },
    onApproveAttempt: () => {
      approvePortCalls += 1;
    },
  });
  return {
    authority,
    repositoryId,
    get readPortCalls() {
      return readPortCalls;
    },
    get approvePortCalls() {
      return approvePortCalls;
    },
    setNow(now: string) {
      currentNow = now;
    },
    issue: async (campaignId: string, envelopeDigest: string) => {
      ensureCampaign(campaignId, envelopeDigest);
      const viewer = await viewerSession.issue({ repositoryId, now: getNow() });
      const issued = await approval.issueToken({ campaignId, envelopeDigest, now: getNow() });
      return { viewerToken: viewer.viewerToken, approvalToken: issued.approvalToken };
    },
    close: () => server.close(),
  };
}
