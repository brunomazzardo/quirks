import path from "node:path";
import { test } from "@playwright/test";
import { CONFORMANCE_RULES } from "./support/visual-conformance.js";
import { openVisualReference } from "./support/visual-reference.js";

/**
 * Opt-in reference renderer for the bounded manual comparison (plan Task 5
 * Step 4). Not a gate: it produces side-by-side capture material for the
 * conformance record, so it only runs when explicitly requested:
 *
 *   QUIRKS_CAPTURE_REFERENCES=1 pnpm exec playwright test test/browser/ui-visual-reference-capture.spec.ts
 *
 * Captures land under test-results/reference-captures/.
 */

const REFERENCES = [
  "docs/visual-references/quirks-ui/approval-workspace-v3.html",
  "docs/visual-references/quirks-ui/tasks-and-campaign-history-v4.html",
  "docs/visual-references/quirks-ui/task-provenance-history-v5.html",
];

const VIEWPORTS = [
  { name: "desktop" as const, size: CONFORMANCE_RULES.viewports.desktop },
  { name: "compact" as const, size: CONFORMANCE_RULES.viewports.compact },
];

for (const reference of REFERENCES) {
  for (const viewport of VIEWPORTS) {
    const referenceId = path.basename(reference, ".html");
    test(`captures ${referenceId} at ${viewport.name}`, async ({ page }) => {
      test.skip(!process.env.QUIRKS_CAPTURE_REFERENCES, "reference capture is opt-in comparison material, not a gate");
      await page.setViewportSize(viewport.size);
      await openVisualReference(page, reference);
      await page.screenshot({
        path: path.join("test-results", "reference-captures", `${referenceId}-${viewport.name}.png`),
        fullPage: true,
        animations: "disabled",
      });
    });
  }
}
