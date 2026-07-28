import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  APP_DISPLAY_NAME,
  DesktopDevServerUrlError,
  DesktopRendererMissingError,
  makeDesktopEnvironment,
  parseDevServerUrl,
  resolveWorkbenchTarget,
} from "./DesktopEnvironment.ts";
import { DESKTOP_URL } from "./DesktopProtocol.ts";

const packagedInput = {
  dirname: "/Apps/Quirks Workbench.app/Contents/Resources/app.asar/dist-electron",
  resourcesPath: "/Apps/Quirks Workbench.app/Contents/Resources",
  isPackaged: true,
  devServerUrl: undefined,
} as const;

const workspaceInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  resourcesPath: "/repo/node_modules/electron/dist/Electron.app/Contents/Resources",
  isPackaged: false,
  devServerUrl: undefined,
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

  it("prefers the packaged renderer over the workspace one", () => {
    const environment = makeDesktopEnvironment(packagedInput);
    expect(environment.rendererDirCandidates[0]).toBe(
      NodePath.join(packagedInput.resourcesPath, "renderer"),
    );
  });

  it("points the workspace candidate at apps/web/dist", () => {
    const environment = makeDesktopEnvironment(workspaceInput);
    expect(environment.rendererDirCandidates[1]).toBe("/repo/apps/web/dist");
  });
});

describe("resolveWorkbenchTarget", () => {
  it("loads the dev server when one is configured, without touching disk", () => {
    const environment = makeDesktopEnvironment({
      ...workspaceInput,
      devServerUrl: "http://localhost:5733",
    });

    expect(
      resolveWorkbenchTarget(environment, () => {
        throw new Error("dev mode must not probe the filesystem");
      }),
    ).toEqual({ _tag: "DevServer", url: "http://localhost:5733/" });
  });

  it("falls through to the first renderer directory holding an index.html", () => {
    const environment = makeDesktopEnvironment(workspaceInput);
    const target = resolveWorkbenchTarget(
      environment,
      (path) => path === "/repo/apps/web/dist/index.html",
    );

    expect(target).toEqual({
      _tag: "Renderer",
      url: DESKTOP_URL,
      directory: "/repo/apps/web/dist",
    });
  });

  it("names every candidate when no renderer was built", () => {
    const environment = makeDesktopEnvironment(workspaceInput);
    expect(() => resolveWorkbenchTarget(environment, () => false)).toThrow(
      DesktopRendererMissingError,
    );
  });
});
