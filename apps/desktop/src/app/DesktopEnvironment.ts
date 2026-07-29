// Path and mode resolution for the Electron main process.
//
// Mirrors t3code's apps/desktop/src/app/DesktopEnvironment.ts: everything the
// main process needs is derived from injected inputs (dirname, resourcesPath,
// isPackaged, env) rather than read from Electron directly, so the resolution
// is unit-testable without booting a browser process.
//
// Trimmed hard for Quirks. t3code's environment also carries backend spawn
// paths, update channels, OTLP endpoints, Clerk keys, WSL/SSH state and
// nightly/alpha branding stages. Quirks is a loopback single-user tool with no
// auth, no relay and no auto-update (S22), so the shell only has to answer two
// questions: are we in development, and where does the renderer live?

import * as NodePath from "node:path";

import { serviceOriginFor } from "@quirks/shared";

/** Set by scripts/dev-electron.mjs; its presence is what "development" means. */
export const DEV_SERVER_URL_ENV = "QUIRKS_DESKTOP_DEV_SERVER_URL";

/** apps/web pins this port with strictPort, so the shell can hardcode it. */
export const DEFAULT_DEV_SERVER_URL = "http://localhost:5733";

export const APP_DISPLAY_NAME = "Quirks Workbench";
export const APP_ID = "dev.quirks.workbench";

/** Which repo's ledger this shell opens. The daemon binds a port derived from
 *  the absolute repo root, so the root IS the choice of ledger. */
export const LEDGER_ROOT_ENV = "QUIRKS_ROOT";

export interface MakeDesktopEnvironmentInput {
  /** Directory holding main.cjs and preload.cjs (i.e. dist-electron). */
  readonly dirname: string;
  /** Electron's process.resourcesPath. */
  readonly resourcesPath: string;
  /** Electron's app.isPackaged. */
  readonly isPackaged: boolean;
  /** Raw DEV_SERVER_URL_ENV value, if any. */
  readonly devServerUrl: string | undefined;
  /** The repo whose ledger to open: QUIRKS_ROOT, else the launch directory. */
  readonly ledgerRoot: string;
}

export interface DesktopEnvironment {
  readonly isDevelopment: boolean;
  readonly isPackaged: boolean;
  readonly displayName: string;
  readonly appId: string;
  readonly preloadPath: string;
  readonly devServerUrl: URL | undefined;
  /** The origin the daemon serves the workbench from — see `serviceOrigin`. */
  readonly serviceOrigin: string;
}

export class DesktopDevServerUrlError extends Error {
  override readonly name = "DesktopDevServerUrlError";

  constructor(rawValue: string, options?: { readonly cause?: unknown }) {
    super(
      `${DEV_SERVER_URL_ENV} must be an http(s) URL, got ${JSON.stringify(rawValue)}`,
      options as ErrorOptions,
    );
  }
}

export function parseDevServerUrl(rawValue: string | undefined): URL | undefined {
  const trimmed = rawValue?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (cause) {
    // Falling through to the packaged renderer would silently turn a typo into
    // a "production" launch against a renderer that may not be built yet.
    throw new DesktopDevServerUrlError(trimmed, { cause });
  }

  // `new URL("localhost:5733")` parses happily as the "localhost:" scheme, so
  // the protocol has to be checked explicitly.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DesktopDevServerUrlError(trimmed);
  }

  return parsed;
}

export function makeDesktopEnvironment(input: MakeDesktopEnvironmentInput): DesktopEnvironment {
  const devServerUrl = parseDevServerUrl(input.devServerUrl);

  return {
    isDevelopment: devServerUrl !== undefined,
    isPackaged: input.isPackaged,
    displayName: APP_DISPLAY_NAME,
    appId: APP_ID,
    preloadPath: NodePath.join(input.dirname, "preload.cjs"),
    devServerUrl,
    serviceOrigin: serviceOriginFor(NodePath.resolve(input.ledgerRoot)),
  };
}

export type WorkbenchTarget =
  /** Development: the apps/web dev server, loaded over http for HMR. */
  | { readonly _tag: "DevServer"; readonly url: string }
  /** Otherwise: the daemon's own origin, which serves the built workbench. */
  | { readonly _tag: "Service"; readonly url: string };

/**
 * Where to point the window.
 *
 * PRODUCTION LOADS THE DAEMON'S ORIGIN, not a bundled copy of the renderer.
 * The shell used to serve apps/web itself over a private `quirks://app` scheme,
 * and that arrangement could not work: `serviceBaseUrl()` is `""`, so every
 * request resolved against the renderer directory — `/v1/goals` returned
 * index.html and `ptySocketUrl` built `ws://app/…`. Pointing VITE_QUIRKS_URL at
 * the daemon would not have fixed it either, because `quirks://app` →
 * `http://127.0.0.1:PORT` is cross-origin and the daemon deliberately sends no
 * CORS headers.
 *
 * QK-WB-009 already made the daemon serve the workbench (apps/server's
 * http/Renderer.ts). Loading that origin makes the shell single-origin like
 * every other client, and deletes the rival static-serving stack outright:
 * the custom scheme, its protocol handler, the renderer-directory search, and
 * the packaged `extraResources` copy of apps/web/dist.
 *
 * WHICH ledger a packaged app should open is a real product question and is
 * NOT answered here: this takes `QUIRKS_ROOT`, else the directory the shell was
 * launched from, which is right for `pnpm --filter @quirks/desktop start` and
 * for a dev launch. A packaged app double-clicked from /Applications inherits
 * no meaningful cwd, so it needs a recent-ledgers picker or a stored root —
 * recorded as work rather than guessed at here.
 */
export function resolveWorkbenchTarget(environment: DesktopEnvironment): WorkbenchTarget {
  if (environment.devServerUrl !== undefined) {
    return { _tag: "DevServer", url: environment.devServerUrl.href };
  }
  return { _tag: "Service", url: `${environment.serviceOrigin}/` };
}
