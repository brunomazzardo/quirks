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

import { DESKTOP_URL, RENDERER_INDEX_FILE } from "./DesktopProtocol.ts";

/** Set by scripts/dev-electron.mjs; its presence is what "development" means. */
export const DEV_SERVER_URL_ENV = "QUIRKS_DESKTOP_DEV_SERVER_URL";

/** apps/web pins this port with strictPort, so the shell can hardcode it. */
export const DEFAULT_DEV_SERVER_URL = "http://localhost:5733";

export const APP_DISPLAY_NAME = "Quirks Workbench";
export const APP_ID = "dev.quirks.workbench";

/** Directory extraResources drops apps/web/dist into inside the packaged app. */
export const PACKAGED_RENDERER_DIR = "renderer";

export interface MakeDesktopEnvironmentInput {
  /** Directory holding main.cjs and preload.cjs (i.e. dist-electron). */
  readonly dirname: string;
  /** Electron's process.resourcesPath. */
  readonly resourcesPath: string;
  /** Electron's app.isPackaged. */
  readonly isPackaged: boolean;
  /** Raw DEV_SERVER_URL_ENV value, if any. */
  readonly devServerUrl: string | undefined;
}

export interface DesktopEnvironment {
  readonly isDevelopment: boolean;
  readonly isPackaged: boolean;
  readonly displayName: string;
  readonly appId: string;
  readonly preloadPath: string;
  readonly devServerUrl: URL | undefined;
  /**
   * Ordered directories to look for the built renderer in. The packaged
   * location wins; the workspace location keeps an unpackaged production run
   * (`pnpm --filter @quirks/desktop start`) working straight out of the repo.
   */
  readonly rendererDirCandidates: readonly string[];
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
    rendererDirCandidates: [
      NodePath.join(input.resourcesPath, PACKAGED_RENDERER_DIR),
      // dist-electron/../../web/dist — apps/desktop and apps/web are siblings.
      NodePath.join(input.dirname, "..", "..", "web", "dist"),
    ],
  };
}

export type WorkbenchTarget =
  /** Development: the apps/web dev server, loaded over http for HMR. */
  | { readonly _tag: "DevServer"; readonly url: string }
  /** Production: the built renderer, served over the custom scheme. */
  | { readonly _tag: "Renderer"; readonly url: string; readonly directory: string };

export class DesktopRendererMissingError extends Error {
  override readonly name = "DesktopRendererMissingError";
  readonly candidates: readonly string[];

  constructor(candidates: readonly string[]) {
    super(
      [
        "Could not find a built renderer (apps/web/dist). Looked in:",
        ...candidates.map((candidate) => `  - ${candidate}`),
        "Run `pnpm --filter @quirks/web build` first.",
      ].join("\n"),
    );
    this.candidates = candidates;
  }
}

/**
 * Dev loads the apps/web dev server over HTTP; production loads the built
 * renderer through the custom scheme. `fileExists` is injected so this stays a
 * pure decision.
 */
export function resolveWorkbenchTarget(
  environment: DesktopEnvironment,
  fileExists: (path: string) => boolean,
): WorkbenchTarget {
  if (environment.devServerUrl !== undefined) {
    return { _tag: "DevServer", url: environment.devServerUrl.href };
  }

  for (const directory of environment.rendererDirCandidates) {
    if (fileExists(NodePath.join(directory, RENDERER_INDEX_FILE))) {
      return { _tag: "Renderer", url: DESKTOP_URL, directory };
    }
  }

  throw new DesktopRendererMissingError(environment.rendererDirCandidates);
}
