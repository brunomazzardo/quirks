import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { loadProjectContext } from "../../../src/project/config.js";
import { InMemoryApprovalTokenStore } from "../../../src/ui/approval/token-store.js";
import { InMemoryViewerSessionStore } from "../../../src/ui/auth/viewer-session-store.js";
import { createLoopbackAuthority } from "../../../src/ui/authority.js";
import { createStandaloneWorkspacePorts, openWorkspace } from "../../../src/ui/open-workspace.js";
import { createUiServer } from "../../../src/ui/server.js";
import { FakeApprovalWritePort } from "../support/fake-approval-write.js";

process.env.QUIRKS_STATE_DIR = await mkdtemp(path.join(os.tmpdir(), "quirks-read-only-ws-"));

const execFileAsync = promisify(execFile);

async function createFixtureProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "quirks-read-only-project-"));
  await cp(path.resolve("test/fixtures/json-project"), root, { recursive: true });
  await execFileAsync("git", ["init", root]);
  return root;
}

async function seedCampaign(
  stateDir: string,
  repositoryId: string,
  campaignId: string,
  overrides?: { status?: string },
): Promise<void> {
  const campaignDir = path.join(
    stateDir,
    "repositories",
    repositoryId.replaceAll(":", "-"),
    "campaigns",
    campaignId,
  );
  await mkdir(campaignDir, { recursive: true });
  await writeFile(
    path.join(campaignDir, "campaign.json"),
    JSON.stringify({
      schemaVersion: 1,
      campaignId,
      repositoryId,
      createdAt: "2026-07-20T09:00:00.000Z",
      taskIds: ["QK-1"],
    }),
  );
  await writeFile(
    path.join(campaignDir, "state.json"),
    JSON.stringify({
      schemaVersion: 1,
      campaignId,
      status: overrides?.status ?? "complete",
      digest: "sha256:abc",
      updatedAt: "2026-07-20T15:00:00.000Z",
    }),
  );
}

async function createReadOnlyServer() {
  const repositoryRoot = await createFixtureProject();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-read-only-state-"));
  const context = await loadProjectContext(repositoryRoot, { mode: "inspection" });
  const repositoryId = context.repositoryId;
  await seedCampaign(stateDir, repositoryId, "C-hist");
  await seedCampaign(stateDir, "sha256:other-repo", "C-foreign");
  await seedCampaign(stateDir, repositoryId, "C-corrupt", { status: "definitely_not_a_status" });
  const authority = await createLoopbackAuthority();
  const viewerSession = new InMemoryViewerSessionStore();
  const approval = new FakeApprovalWritePort(new InMemoryApprovalTokenStore());
  const ports = createStandaloneWorkspacePorts({ repositoryRoot, stateDir });
  const server = await createUiServer({
    authority,
    repositoryId,
    viewerSession,
    approval,
    readOnly: true,
    getCampaign: () => undefined,
    ...ports,
  });
  const viewer = await viewerSession.issue({ repositoryId, now: new Date().toISOString() });
  return { authority, server, repositoryId, viewerToken: viewer.viewerToken };
}

function readHeaders(authority: { hostHeader: string; origin: string }, token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Host: authority.hostHeader,
    Origin: authority.origin,
    "Sec-Fetch-Site": "same-origin",
  };
}

test("approval POST on a read-only workspace returns 409 read_only_workspace", async () => {
  const { authority, server, viewerToken } = await createReadOnlyServer();
  try {
    const response = await fetch(`${authority.baseUrl}/api/v1/approval`, {
      method: "POST",
      headers: {
        ...readHeaders(authority, viewerToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        schemaVersion: 1,
        campaignId: "C-hist",
        envelopeDigest: "sha256:abc",
        approvalToken: "qkapprove_forged",
      }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      schemaVersion: 1,
      result: "invalid",
      error: "read_only_workspace",
    });
  } finally {
    await server.close();
  }
});

test("read-only workspace still requires viewer auth for approval POST", async () => {
  const { authority, server } = await createReadOnlyServer();
  try {
    const response = await fetch(`${authority.baseUrl}/api/v1/approval`, {
      method: "POST",
      headers: {
        Host: authority.hostHeader,
        Origin: authority.origin,
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({ schemaVersion: 1 }),
    });
    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});

test("read-only workspace serves every GET read-model route", async () => {
  const { authority, server, repositoryId, viewerToken } = await createReadOnlyServer();
  try {
    const headers = readHeaders(authority, viewerToken);

    const existingTasks = await fetch(`${authority.baseUrl}/api/v1/existing-tasks`, { headers });
    assert.equal(existingTasks.status, 200);
    const tasksBody = (await existingTasks.json()) as { tasks: Array<{ id: string; title: string }> };
    assert.ok(tasksBody.tasks.some((task) => task.id === "QK-1" && task.title === "Contract task"));

    const campaigns = await fetch(`${authority.baseUrl}/api/v1/campaigns`, { headers });
    assert.equal(campaigns.status, 200);
    const campaignsBody = (await campaigns.json()) as {
      items: Array<{ campaignId: string; state: string; taskCount: number; repositoryId: string }>;
    };
    assert.deepEqual(campaignsBody.items, [
      {
        campaignId: "C-hist",
        repositoryId,
        state: "complete",
        taskCount: 1,
        startedAt: "2026-07-20T09:00:00.000Z",
      },
    ]);

    const detail = await fetch(`${authority.baseUrl}/api/v1/campaigns/C-hist`, { headers });
    assert.equal(detail.status, 200);
    const detailBody = (await detail.json()) as {
      campaignId: string;
      state: string;
      tasks: Array<{ taskId: string; title: string; status: string }>;
      waves: unknown[];
    };
    assert.equal(detailBody.campaignId, "C-hist");
    assert.equal(detailBody.state, "complete");
    assert.deepEqual(detailBody.tasks, [{ taskId: "QK-1", title: "Contract task", status: "ready" }]);
    assert.deepEqual(detailBody.waves, []);

    const history = await fetch(`${authority.baseUrl}/api/v1/tasks/QK-1/history`, { headers });
    assert.equal(history.status, 200);
    const historyBody = (await history.json()) as { schemaVersion: number; taskId: string; iterations: unknown[] };
    assert.deepEqual(historyBody, { schemaVersion: 1, taskId: "QK-1", iterations: [] });
  } finally {
    await server.close();
  }
});

test("standalone plan progress reports unavailable instead of fabricating a plan", async () => {
  const { authority, server, viewerToken } = await createReadOnlyServer();
  try {
    const headers = readHeaders(authority, viewerToken);
    const progress = await fetch(
      `${authority.baseUrl}/api/v1/tasks/QK-1/plan-progress?campaignId=C-hist`,
      { headers },
    );
    assert.equal(progress.status, 404);
    assert.deepEqual(await progress.json(), { schemaVersion: 1, result: "invalid" });
  } finally {
    await server.close();
  }
});

test("standalone campaigns are scoped to the workspace repository", async () => {
  const { authority, server, repositoryId, viewerToken } = await createReadOnlyServer();
  try {
    const headers = readHeaders(authority, viewerToken);

    const list = await fetch(`${authority.baseUrl}/api/v1/campaigns`, { headers });
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as { items: Array<{ campaignId: string; repositoryId: string }> };
    assert.deepEqual(
      listBody.items.map((item) => item.campaignId),
      ["C-hist"],
    );
    assert.ok(listBody.items.every((item) => item.repositoryId === repositoryId));

    const foreignQuery = await fetch(
      `${authority.baseUrl}/api/v1/campaigns?repositoryId=${encodeURIComponent("sha256:other-repo")}`,
      { headers },
    );
    assert.equal(foreignQuery.status, 200);
    assert.deepEqual(((await foreignQuery.json()) as { items: unknown[] }).items, []);

    const foreignDetail = await fetch(`${authority.baseUrl}/api/v1/campaigns/C-foreign`, { headers });
    assert.equal(foreignDetail.status, 404);

    const foreignProgress = await fetch(
      `${authority.baseUrl}/api/v1/tasks/QK-1/plan-progress?campaignId=C-foreign`,
      { headers },
    );
    assert.equal(foreignProgress.status, 404);
  } finally {
    await server.close();
  }
});

test("standalone campaigns list skips invalid campaign records", async () => {
  const { authority, server, viewerToken } = await createReadOnlyServer();
  try {
    const headers = readHeaders(authority, viewerToken);
    const list = await fetch(`${authority.baseUrl}/api/v1/campaigns`, { headers });
    assert.equal(list.status, 200);
    const listBody = (await list.json()) as { items: Array<{ campaignId: string }> };
    assert.ok(!listBody.items.some((item) => item.campaignId === "C-corrupt"));

    const corruptDetail = await fetch(`${authority.baseUrl}/api/v1/campaigns/C-corrupt`, { headers });
    assert.equal(corruptDetail.status, 404);
  } finally {
    await server.close();
  }
});

test("standalone openWorkspace wires read-only projections end to end", async () => {
  const repositoryRoot = await createFixtureProject();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "quirks-read-only-open-"));
  const context = await loadProjectContext(repositoryRoot, { mode: "inspection" });
  await seedCampaign(stateDir, context.repositoryId, "C-hist");
  const result = await openWorkspace({
    repositoryRoot,
    stateDir,
    deps: { json: true, isTty: false },
  });
  try {
    assert.equal(result.readOnly, true);
    const viewerToken = /viewToken=([^&]+)/.exec(result.launchUrl)?.[1];
    assert.ok(viewerToken);
    const headers = {
      Authorization: `Bearer ${decodeURIComponent(viewerToken)}`,
      Origin: result.authority,
      "Sec-Fetch-Site": "same-origin",
    };

    const campaigns = await fetch(`${result.authority}/api/v1/campaigns`, { headers });
    assert.equal(campaigns.status, 200);
    const campaignsBody = (await campaigns.json()) as { items: Array<{ campaignId: string }> };
    assert.deepEqual(
      campaignsBody.items.map((item) => item.campaignId),
      ["C-hist"],
    );

    const approval = await fetch(`${result.authority}/api/v1/approval`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1 }),
    });
    assert.equal(approval.status, 409);
    assert.deepEqual(await approval.json(), {
      schemaVersion: 1,
      result: "invalid",
      error: "read_only_workspace",
    });
  } finally {
    await result.close?.();
  }
});
