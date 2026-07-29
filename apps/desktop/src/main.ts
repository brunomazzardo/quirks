// Electron main process for the Quirks workbench.
//
// Mirrors t3code's apps/desktop/src/main.ts as a wiring root: resolve the
// environment, create the window onto the daemon's origin, own the app
// lifecycle. t3code composes that through ~30 Effect layers because it has
// services to compose (backend pool, SSH/WSL environments, Clerk, updates,
// previews, IPC). Quirks has none of them yet — QK-WB-002 hosts apps/web and
// nothing else — so the shell stays plain TypeScript. Effect belongs here the
// moment the shell owns state.
//
// Bundled to dist-electron/main.cjs by `vp pack` (see vite.config.ts), which
// is what package.json "main" points at.

import { writeSync } from "node:fs";

import { app, BrowserWindow } from "electron";

import {
  APP_DISPLAY_NAME,
  APP_ID,
  DEV_SERVER_URL_ENV,
  LEDGER_ROOT_ENV,
  makeDesktopEnvironment,
  resolveWorkbenchTarget,
  type WorkbenchTarget,
} from "./app/DesktopEnvironment.ts";
import { createWorkbenchWindow } from "./window/DesktopWindow.ts";

// Replaces t3code's playwright-core smoke harness: when set, the shell reports
// the window it opened and quits, so a launch can be asserted in CI or by an
// agent without leaving a window on someone's screen.
const SMOKE_EXIT_MS_ENV = "QUIRKS_DESKTOP_SMOKE_EXIT_MS";

const environment = makeDesktopEnvironment({
  dirname: __dirname,
  resourcesPath: process.resourcesPath,
  isPackaged: app.isPackaged,
  devServerUrl: process.env[DEV_SERVER_URL_ENV],
  // Which ledger this window opens. `process.cwd()` is right for a dev launch
  // and for `pnpm --filter @quirks/desktop start`; a packaged app inherits no
  // meaningful cwd and needs QUIRKS_ROOT until a ledger picker exists.
  ledgerRoot: process.env[LEDGER_ROOT_ENV] ?? process.cwd(),
});

// process.stdout.write is asynchronous, and app.quit()/app.exit() tear the
// process down without draining it — in a packaged app the message is simply
// lost. Anything written on the way out has to go out synchronously.
function writeLine(fd: 1 | 2, line: string): void {
  writeSync(fd, `${line}\n`);
}

function parseSmokeExitMs(rawValue: string | undefined): number | undefined {
  const parsed = Number.parseInt(rawValue?.trim() ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function scheduleSmokeExit(window: BrowserWindow, exitAfterMs: number): void {
  window.webContents.once("did-finish-load", () => {
    writeLine(
      1,
      `[desktop-smoke] loaded title=${JSON.stringify(window.getTitle())} url=${JSON.stringify(
        window.webContents.getURL(),
      )} development=${environment.isDevelopment} packaged=${environment.isPackaged}`,
    );
  });

  setTimeout(() => {
    writeLine(1, "[desktop-smoke] quitting");
    app.quit();
  }, exitAfterMs).unref();
}

// Resolved once: the daemon's origin is derived from a repo root that cannot
// change while the app is running.
let workbenchTarget: WorkbenchTarget | undefined;

function ensureWorkbenchTarget(): WorkbenchTarget {
  if (workbenchTarget !== undefined) {
    return workbenchTarget;
  }

  workbenchTarget = resolveWorkbenchTarget(environment);
  return workbenchTarget;
}

function openWorkbenchWindow(): void {
  const window = createWorkbenchWindow(environment, ensureWorkbenchTarget());
  const smokeExitMs = parseSmokeExitMs(process.env[SMOKE_EXIT_MS_ENV]);
  if (smokeExitMs !== undefined) {
    scheduleSmokeExit(window, smokeExitMs);
  }
}

// A second launch focuses the existing workbench rather than opening a rival
// window onto the same ledger.
if (app.requestSingleInstanceLock()) {
  app.setName(APP_DISPLAY_NAME);
  app.setAppUserModelId(APP_ID);
  app.on("second-instance", () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing === undefined) {
      return;
    }
    if (existing.isMinimized()) {
      existing.restore();
    }
    existing.focus();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openWorkbenchWindow();
    }
  });

  // .catch rather than an onRejected argument, so a throw from
  // openWorkbenchWindow (e.g. no renderer built) is reported too.
  app
    .whenReady()
    .then(openWorkbenchWindow)
    .catch((cause: unknown) => {
      writeLine(
        2,
        `[desktop] failed to open the workbench window: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      app.exit(1);
    });
} else {
  app.quit();
}
