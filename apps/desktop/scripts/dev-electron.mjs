// Dev launch: wait for the bundles and the apps/web dev server, then open the
// workbench against http://localhost:5733.
//
// Mirrored from t3code's apps/desktop/scripts/dev-electron.mjs minus its
// watch/restart supervisor and macOS protocol-client registration. t3code
// restarts the app on every main/preload rebuild because its main process
// carries the whole backend; the Quirks shell only loads a URL, and the web
// dev server already hot-reloads everything that changes, so a restart loop
// would buy nothing and risk leaving orphaned windows behind.
//
// This script deliberately does NOT start the web dev server: run
// `pnpm --filter @quirks/web dev` alongside it.

import { desktopDir, MAIN_ENTRY, PRELOAD_ENTRY, runElectron } from "./electron-launcher.mjs";
import { waitForResources } from "./wait-for-resources.mjs";

const DEFAULT_DEV_SERVER_URL = "http://localhost:5733";
const DEV_SERVER_URL_ENV = "QUIRKS_DESKTOP_DEV_SERVER_URL";

const devServerUrl = new URL(process.env[DEV_SERVER_URL_ENV]?.trim() || DEFAULT_DEV_SERVER_URL);
const port = Number.parseInt(devServerUrl.port, 10);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`${DEV_SERVER_URL_ENV} must include an explicit port: ${devServerUrl.href}`);
}

await waitForResources({
  baseDir: desktopDir,
  files: [MAIN_ENTRY, PRELOAD_ENTRY],
  tcpHost: devServerUrl.hostname,
  tcpPort: port,
  hint: `Start the workbench dev server first: pnpm --filter @quirks/web dev (expected at ${devServerUrl.href}).`,
});

runElectron({ env: { [DEV_SERVER_URL_ENV]: devServerUrl.href } });
