import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { serviceOriginFor } from "@quirks/shared";

import {
  APP_DISPLAY_NAME,
  DesktopDevServerUrlError,
  makeDesktopEnvironment,
  parseDevServerUrl,
  resolveWorkbenchTarget,
} from "./DesktopEnvironment.ts";

const workspaceInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  resourcesPath: "/repo/node_modules/electron/dist/Electron.app/Contents/Resources",
  isPackaged: false,
  devServerUrl: undefined,
  ledgerRoot: "/repo",
} as const;

describe("parseDevServerUrl", () => {
  it("treats missing and blank values as production", () => {
    expect(parseDevServerUrl(undefined)).toBeUndefined();
    expect(parseDevServerUrl("   ")).toBeUndefined();
  });

  it("rejects a malformed URL instead of silently falling back to production", () => {
    expect(() => parseDevServerUrl("http://[")).toThrow(DesktopDevServerUrlError);
  });

  it("rejects a scheme the shell cannot load, including the URL(1)-legal 'localhost:5733'", () => {
    expect(() => parseDevServerUrl("localhost:5733")).toThrow(DesktopDevServerUrlError);
    expect(() => parseDevServerUrl("file:///tmp/index.html")).toThrow(DesktopDevServerUrlError);
  });
});

describe("makeDesktopEnvironment", () => {
  it("resolves the preload next to the main bundle", () => {
    const environment = makeDesktopEnvironment(workspaceInput);
    expect(environment.preloadPath).toBe(NodePath.join(workspaceInput.dirname, "preload.cjs"));
    expect(environment.displayName).toBe(APP_DISPLAY_NAME);
  });

  it("is development exactly when a dev server URL is set", () => {
    expect(makeDesktopEnvironment(workspaceInput).isDevelopment).toBe(false);
    expect(
      makeDesktopEnvironment({ ...workspaceInput, devServerUrl: "http://localhost:5733" })
        .isDevelopment,
    ).toBe(true);
  });

  it("derives the service origin from the ledger root, like every other client", () => {
    // The same derivation the daemon binds and the CLI dials (@quirks/shared).
    // A second copy of it here would be a window onto a port nobody is serving.
    expect(makeDesktopEnvironment(workspaceInput).serviceOrigin).toBe(serviceOriginFor("/repo"));
  });

  it("resolves a relative ledger root — the port is a hash of the ABSOLUTE path", () => {
    const environment = makeDesktopEnvironment({ ...workspaceInput, ledgerRoot: "." });
    expect(environment.serviceOrigin).toBe(serviceOriginFor(NodePath.resolve(".")));
  });
});

describe("resolveWorkbenchTarget", () => {
  it("loads the dev server when one is configured", () => {
    const environment = makeDesktopEnvironment({
      ...workspaceInput,
      devServerUrl: "http://localhost:5733",
    });

    expect(resolveWorkbenchTarget(environment)).toEqual({
      _tag: "DevServer",
      url: "http://localhost:5733/",
    });
  });

  it("otherwise loads the DAEMON'S origin, not a bundled copy of the renderer", () => {
    // The shell used to serve apps/web itself over `quirks://app`, which put the
    // page on an origin the service could not answer: `serviceBaseUrl()` is ""
    // so /v1/goals resolved to index.html, and the pty socket became ws://app/.
    // Same-origin is the only arrangement in which the workbench works at all.
    const environment = makeDesktopEnvironment(workspaceInput);
    const target = resolveWorkbenchTarget(environment);

    expect(target).toEqual({ _tag: "Service", url: `${serviceOriginFor("/repo")}/` });
    expect(target.url.startsWith("http://127.0.0.1:")).toBe(true);
  });
});
