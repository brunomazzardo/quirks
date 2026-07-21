import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    channel: "chrome",
    headless: true,
    acceptDownloads: false,
    javaScriptEnabled: true,
    bypassCSP: false,
  },
});
