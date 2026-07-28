import { describe, expect, it } from "vite-plus/test";

import { DESKTOP_ORIGIN, resolveRendererRequest } from "./DesktopProtocol.ts";

const rendererDir = "/repo/apps/web/dist";
const indexPath = "/repo/apps/web/dist/index.html";
const bundlePath = "/repo/apps/web/dist/assets/index-abc.js";

const present = new Set([indexPath, bundlePath]);
const fileExists = (path: string) => present.has(path);

const resolve = (requestUrl: string) =>
  resolveRendererRequest({ rendererDir, requestUrl, fileExists });

describe("resolveRendererRequest", () => {
  it("serves index.html at the root", () => {
    expect(resolve(`${DESKTOP_ORIGIN}/`)).toEqual({ _tag: "File", path: indexPath });
  });

  it("serves the absolute asset URLs the Vite build emits", () => {
    expect(resolve(`${DESKTOP_ORIGIN}/assets/index-abc.js`)).toEqual({
      _tag: "File",
      path: bundlePath,
    });
  });

  it("falls back to index.html for client-side routes", () => {
    expect(resolve(`${DESKTOP_ORIGIN}/goals/QK-WB-002`)).toEqual({ _tag: "File", path: indexPath });
  });

  it("404s a missing asset rather than answering it with HTML", () => {
    const resolution = resolve(`${DESKTOP_ORIGIN}/assets/gone.js`);
    expect(resolution._tag).toBe("NotFound");
  });

  it("ignores query strings and fragments when locating the file", () => {
    expect(resolve(`${DESKTOP_ORIGIN}/assets/index-abc.js?v=1#top`)).toEqual({
      _tag: "File",
      path: bundlePath,
    });
  });

  it("refuses to escape the renderer root", () => {
    for (const path of ["/../../../etc/passwd", "/..%2f..%2fetc/passwd", "/assets/../../secret"]) {
      const resolution = resolve(`${DESKTOP_ORIGIN}${path}`);
      if (resolution._tag === "File") {
        expect(resolution.path.startsWith(rendererDir)).toBe(true);
      }
    }
  });

  it("rejects requests aimed at another host on the scheme", () => {
    expect(resolve("quirks://elsewhere/index.html")._tag).toBe("NotFound");
  });

  it("reports a missing renderer index instead of throwing", () => {
    const resolution = resolveRendererRequest({
      rendererDir,
      requestUrl: `${DESKTOP_ORIGIN}/`,
      fileExists: () => false,
    });

    expect(resolution).toEqual({
      _tag: "NotFound",
      reason: `renderer index is missing: ${indexPath}`,
    });
  });
});
