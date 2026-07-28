// Electron main process for the Quirks workbench.
//
// Mirrors t3code's apps/desktop/src/main.ts as a wiring root: resolve the
// environment, register the renderer scheme, create the window, own the app
// lifecycle. t3code composes that through ~30 Effect layers because it has
// services to compose (backend pool, SSH/WSL environments, Clerk, updates,
// previews, IPC). Quirks has none of them yet — QK-WB-002 hosts apps/web and
// nothing else — so the shell stays plain TypeScript. Effect belongs here the
// moment the shell owns state.
//
// Bundled to dist-electron/main.cjs by `vp pack` (see vite.config.ts), which
// is what package.json "main" points at.

import { existsSync, writeSync } from "node:fs";

import { app, BrowserWindow } from "electron";

import {
  APP_DISPLAY_NAME,
  APP_ID,
  DEV_SERVER_URL_ENV,
  makeDesktopEnvironment,
  resolveWorkbenchTarget,
  type WorkbenchTarget,
} from "./app/DesktopEnvironment.ts";
import {
  handleDesktopScheme,
  registerDesktopSchemeAsPrivileged,
} from "./electron/ElectronProtocol.ts";
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

// Resolved once: the renderer cannot move while the app is running, and the
// protocol handler must only be registered once per session.
let workbenchTarget: WorkbenchTarget | undefined;

function ensureWorkbenchTarget(): WorkbenchTarget {
  if (workbenchTarget !== undefined) {
    return workbenchTarget;
  }

  const target = resolveWorkbenchTarget(environment, existsSync);
  if (target._tag === "Renderer") {
    handleDesktopScheme(target.directory);
  }

  workbenchTarget = target;
  return target;
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
  // Has to happen before the app is ready, so it cannot live inside the
  // whenReady handler with the rest of the wiring.
  registerDesktopSchemeAsPrivileged();

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
