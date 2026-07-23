import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "@playwright/test";

/** file:// URL for a tracked visual reference (self-contained HTML, no network). */
export function referenceFileUrl(relativePath: string): string {
  return pathToFileURL(path.resolve(relativePath)).href;
}

/**
 * Renders a tracked reference for bounded manual comparison (plan Task 5
 * Step 4). The `.feedback` chooser rows are brainstorm apparatus, not product
 * UI (design handoff §1), so they are hidden before capture.
 */
export async function openVisualReference(page: Page, relativePath: string): Promise<void> {
  await page.goto(referenceFileUrl(relativePath));
  await page.addStyleTag({ content: ".feedback { display: none !important; }" });
}
