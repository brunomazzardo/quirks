// Creates and loads the workbench window.
//
// Mirrors t3code's src/window/DesktopWindow.ts window options and navigation
// guard. Trimmed: no splash window, no persisted bounds, no theme sync, no
// preview webviews, no custom title bar overlay — those all belong to features
// Quirks has not built yet, and a hidden title bar with nothing drawn behind it
// is worse than the platform default.

import { BrowserWindow, shell } from "electron";

import type { DesktopEnvironment, WorkbenchTarget } from "../app/DesktopEnvironment.ts";

const DEFAULT_WINDOW_WIDTH = 1_360;
const DEFAULT_WINDOW_HEIGHT = 900;
const MINIMUM_WINDOW_WIDTH = 840;
const MINIMUM_WINDOW_HEIGHT = 620;

// Matches apps/web's dark background so the window does not flash white before
// the first paint.
const INITIAL_BACKGROUND_COLOR = "#09090b";

/**
 * True when a navigation should stay inside the shell. Both targets have a
 * real origin — the dev server's, or the custom scheme's — so this is one
 * origin comparison either way. Anything else (docs links, agent output) is
 * the user's browser's business.
 */
export function isInternalNavigation(target: WorkbenchTarget, navigationUrl: string): boolean {
  try {
    return new URL(navigationUrl).origin === new URL(target.url).origin;
  } catch {
    return false;
  }
}

function openExternally(url: string): void {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    void shell.openExternal(url);
  }
}

function guardNavigation(window: BrowserWindow, target: WorkbenchTarget): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isInternalNavigation(target, url)) {
      return;
    }

    event.preventDefault();
    openExternally(url);
  });
}

export function createWorkbenchWindow(
  environment: DesktopEnvironment,
  target: WorkbenchTarget,
): BrowserWindow {
  const window = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: MINIMUM_WINDOW_WIDTH,
    minHeight: MINIMUM_WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: INITIAL_BACKGROUND_COLOR,
    title: environment.displayName,
    webPreferences: {
      preload: environment.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // apps/web sets <title>Quirks</title>; the window keeps the product name.
  window.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  guardNavigation(window, target);
  void window.loadURL(target.url);

  return window;
}
