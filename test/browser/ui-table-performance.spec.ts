import { readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import type { UiPreflightProposalV1 } from "../../src/ui/types/preflight-proposal.js";
import { VIEWPORTS } from "./support/viewports.js";
import { launchUiFixture } from "./support/launch-ui.js";

async function loadThousandRowFixture() {
  const raw = await readFile(path.resolve("test/ui/fixtures/thousand-history-items.json"), "utf8");
  return JSON.parse(raw) as {
    taskId: string;
    items: Array<{ rowId: string; iterationId: string; outcome: string; artifactRef: Record<string, unknown> }>;
  };
}

function buildLargePreflightProposal(campaignId: string, taskCount: number): UiPreflightProposalV1 {
  const tasks = Array.from({ length: taskCount }, (_, index) => ({
    taskId: `QK-${String(index + 1).padStart(4, "0")}`,
    title: `Task ${index + 1}`,
    waveId: "wave-1",
    laneId: "lane-1",
    route: { profileId: "cursor", tier: "standard" as const, effort: "standard" as const },
    fallback: { profileId: "cursor-reviewer", tier: "high" as const, effort: "standard" as const },
    confidence: "high" as const,
  }));
  return {
    schemaVersion: 1,
    campaignId,
    state: "awaiting_approval",
    envelopeDigest: "sha256:abc",
    summary: {
      taskCount,
      waveCount: 1,
      estimatedMinutes: 120,
      confidence: "medium",
      budget: { maxWallClockMs: 3_600_000, maxConcurrency: 2 },
      landing: { baseCommit: "a".repeat(40), campaignBranch: `campaign/${campaignId}`, targetBranch: "main" },
      push: { enabled: false, remote: null, branch: null },
    },
    waves: [{ id: "wave-1", label: "Wave 1", taskIds: tasks.map((task) => task.taskId) }],
    lanes: [{ id: "lane-1", label: "Lane 1", runner: "cursor", model: "composer-2.5", taskIds: tasks.slice(0, 10).map((task) => task.taskId) }],
    tasks,
    inspector: null,
    residuals: [],
    humanGates: [],
    unsupportedCapabilities: [],
    approval: { campaignId, envelopeDigest: "sha256:abc" },
  };
}

for (const viewport of VIEWPORTS) {
  test(`preflight filter median budget at ${viewport.name}`, async ({ page }) => {
    const fixture = await loadThousandRowFixture();
    const campaignId = "C-PERF";
    const ui = await launchUiFixture({
      campaignId,
      preflightProposals: {
        [campaignId]: buildLargePreflightProposal(campaignId, fixture.items.length),
      },
    });

    await page.setViewportSize(viewport.size);
    await page.goto(ui.preflightUrl);
    await expect(page.getByRole("heading", { name: "Preflight proposal" })).toBeVisible();
    const filter = page.getByLabel(/filter tasks/i);
    await filter.fill("QK-0999");
    await page.waitForFunction((expected) => {
        const rows = document.querySelectorAll("table tbody tr");
        return rows.length === 1 && rows[0]?.textContent?.includes(expected);
      }, "QK-0999");

    const samples: number[] = [];
    for (let cycle = 0; cycle < 5; cycle += 1) {
      const query = cycle % 2 === 0 ? "QK-0001" : "QK-0500";
      const started = Date.now();
      await filter.fill(query);
      await page.waitForFunction((expected) => {
        const rows = document.querySelectorAll("table tbody tr");
        return rows.length === 1 && rows[0]?.textContent?.includes(expected);
      }, query);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      samples.push(Date.now() - started);
    }

    samples.sort((left, right) => left - right);
    const median = samples[Math.floor(samples.length / 2)] ?? Number.POSITIVE_INFINITY;
    expect(median).toBeLessThanOrEqual(250);
    await ui.close();
  });
}
