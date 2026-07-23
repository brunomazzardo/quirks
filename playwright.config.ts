import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  // QK-VIS-003 screenshot baselines are reviewed, committed artifacts; the
  // platform suffix records the rasterizer they were captured on (rules
  // fixture: test/ui/fixtures/visual-conformance-rules.json).
  snapshotPathTemplate: "{testDir}/../visual-references/baselines/{arg}-{platform}{ext}",
  use: {
    channel: "chrome",
    headless: true,
    acceptDownloads: false,
    javaScriptEnabled: true,
    bypassCSP: false,
  },
});
