import type { UiPreflightProposalV1 } from "../../../src/ui/types/preflight-proposal.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { createTestUiServer, type TestCampaign, type TestUiServer } from "../../ui/support/test-server.js";

async function loadBuiltClientBundle(): Promise<string> {
  return readFile(path.resolve("dist/ui/client.bundle.js"), "utf8");
}

const CAMPAIGN_ID = "C-1";
const ISSUED_DIGEST = "sha256:abc";

export type UiFixture = {
  server: TestUiServer;
  baseUrl: string;
  preflightUrl: string;
  campaignDetailUrl: string;
  campaignId: string;
  viewerToken: string;
  approvalToken: string;
  setClock: (iso: string) => void;
  clickApprove: (page: Page) => Promise<void>;
  close: () => Promise<void>;
};

export type LaunchUiOptions = {
  campaignId?: string;
  now?: string;
  includeTokens?: boolean;
  campaigns?: Record<string, TestCampaign>;
  preflightProposals?: Record<string, UiPreflightProposalV1>;
};

export function attachLoopbackNetworkGuard(page: Page, allowedOrigin: string): { assertLoopbackOnly: () => void } {
  const allowedHost = new URL(allowedOrigin).host;
  const violations: string[] = [];

  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) return;
    const parsed = new URL(url);
    if (parsed.host !== allowedHost) {
      violations.push(url);
    }
  });

  return {
    assertLoopbackOnly() {
      if (violations.length > 0) {
        throw new Error(`non-loopback requests:\n${violations.join("\n")}`);
      }
    },
  };
}

export async function launchUiFixture(options?: LaunchUiOptions): Promise<UiFixture> {
  const campaignId = options?.campaignId ?? CAMPAIGN_ID;
  const includeTokens = options?.includeTokens ?? true;
  const server = await createTestUiServer({
    now: options?.now ?? "2026-07-21T12:00:00.000Z",
    clientScript: await loadBuiltClientBundle(),
    campaigns: options?.campaigns ?? {
      [campaignId]: { repositoryId: "repo-1", envelopeDigest: ISSUED_DIGEST, status: "awaiting_approval" },
    },
    ...(options?.preflightProposals ? { preflightProposals: options.preflightProposals } : {}),
  });

  process.env.QUIRKS_UI_TEST_PORT = String(server.authority.port);

  const tokens = includeTokens
    ? await server.issue(campaignId, ISSUED_DIGEST)
    : { viewerToken: "", approvalToken: "" };

  const preflightPath = `/preflight/${campaignId}`;
  const campaignDetailPath = `/campaigns/${campaignId}`;
  const viewerFragment =
    includeTokens && tokens.viewerToken.length > 0
      ? `viewToken=${encodeURIComponent(tokens.viewerToken)}`
      : "";
  const approvalFragment =
    includeTokens && tokens.approvalToken.length > 0
      ? `approvalToken=${encodeURIComponent(tokens.approvalToken)}`
      : "";
  const preflightFragment =
    viewerFragment.length > 0
      ? `#${viewerFragment}${approvalFragment.length > 0 ? `&${approvalFragment}` : ""}`
      : "";
  const campaignDetailFragment = viewerFragment.length > 0 ? `#${viewerFragment}` : "";
  const preflightUrl = `${server.authority.baseUrl}${preflightPath}${preflightFragment}`;
  const campaignDetailUrl = `${server.authority.baseUrl}${campaignDetailPath}${campaignDetailFragment}`;

  return {
    server,
    baseUrl: server.authority.baseUrl,
    preflightUrl,
    campaignDetailUrl,
    campaignId,
    viewerToken: tokens.viewerToken,
    approvalToken: tokens.approvalToken,
    setClock: (iso: string) => server.setNow(iso),
    async clickApprove(page) {
      await page.getByLabel(/reviewed the preflight proposal/i).check();
      const approveButton = page.getByRole("button", { name: /approve campaign/i });
      await expect(approveButton).toBeEnabled();
      await approveButton.click();
    },
    close: () => server.close(),
  };
}

export async function assertClientStateFreeOfCredentials(
  page: Page,
  secrets: readonly string[],
): Promise<void> {
  const snapshot = await page.evaluate(() => ({
    href: window.location.href,
    hash: window.location.hash,
    search: window.location.search,
    historyState: JSON.stringify(history.state),
    localStorage: JSON.stringify(localStorage),
    sessionStorage: JSON.stringify(sessionStorage),
    bodyScriptCount: document.body.querySelectorAll("script").length,
  }));

  const haystack = JSON.stringify(snapshot);
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    if (haystack.includes(secret)) {
      throw new Error(`credential leaked into client state: ${secret.slice(0, 12)}…`);
    }
  }
}
