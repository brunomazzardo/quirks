// The renderer served from the service's own origin (QK-WB-009).
//
// The resolution rules are apps/desktop/src/app/DesktopProtocol.test.ts's,
// re-asserted for the HTTP case: root serves index.html, the Vite build's
// absolute /assets/... URLs resolve, client-side routes fall back to the
// document, a missing asset 404s rather than being answered with HTML, and
// nothing escapes the renderer root. Asserted through the composed app rather
// than against a pure resolver, because on this origin the interesting property
// is not "which file" but "which layer wins" — /v1, /shape and /health must
// still beat the catch-all.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { makeWebHandler } from "../App.ts";
import { defaultRendererDir, RENDERER_DIR_ENV, resolveRendererDir } from "./Renderer.ts";
import { tempRoot } from "../testing/Harness.ts";

const disposers: Array<() => Promise<void>> = [];

const INDEX_HTML = `<!doctype html><html><head><title>Quirks</title>
<script type="module" crossorigin src="/assets/index-abc.js"></script>
</head><body><div id="root"></div></body></html>`;

const BUNDLE_JS = `export const marker = "renderer-bundle";\n`;

/** A renderer build with the shape `vp build` actually emits. */
function rendererBuild(): string {
  const dir = mkdtempSync(join(tmpdir(), "quirks-renderer-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "index.html"), INDEX_HTML);
  writeFileSync(join(dir, "assets", "index-abc.js"), BUNDLE_JS);
  writeFileSync(join(dir, "assets", "index-abc.css"), ":root{--x:1}\n");
  writeFileSync(join(dir, "assets", "dm-sans.woff2"), "not-really-a-font");
  // Something outside the build, to prove traversal cannot reach it. It carries
  // an extension so an escape attempt is an ASSET request — which must 404
  // rather than quietly resolving to the SPA document and passing by accident.
  writeFileSync(join(dir, "..", "quirks-renderer-secret.txt"), "SECRET");
  return dir;
}

function appFor(options: { rendererDir?: string | undefined } = {}) {
  const root = tempRoot("quirks-renderer-root-");
  const { handler, dispose } = makeWebHandler({ root, ...options });
  disposers.push(dispose);
  const url = (path: string) => `http://127.0.0.1${path}`;
  return {
    root,
    get: (path: string, init?: RequestInit) => handler(new Request(url(path), init)),
  };
}

afterAll(async () => {
  for (const dispose of disposers) await dispose();
});

describe("renderer directory resolution", () => {
  it("defaults to the workspace apps/web/dist", () => {
    expect(defaultRendererDir().endsWith(join("apps", "web", "dist"))).toBe(true);
    expect(resolveRendererDir(undefined, {})).toBe(defaultRendererDir());
  });

  it("honors QUIRKS_RENDERER_DIR, so packaging can relocate the build", () => {
    expect(resolveRendererDir(undefined, { [RENDERER_DIR_ENV]: "/opt/quirks/renderer" })).toBe(
      "/opt/quirks/renderer",
    );
  });

  it("prefers an explicit directory over the environment", () => {
    expect(resolveRendererDir("/explicit", { [RENDERER_DIR_ENV]: "/from/env" })).toBe("/explicit");
  });

  it("ignores a blank override rather than serving the process cwd", () => {
    expect(resolveRendererDir("   ", { [RENDERER_DIR_ENV]: "  " })).toBe(defaultRendererDir());
  });

  it("resolves a relative override against the process, never leaving it relative", () => {
    expect(resolveRendererDir("./dist", {}).startsWith("/")).toBe(true);
  });
});

describe("serving the built renderer", () => {
  it("serves index.html at the root", async () => {
    const response = await appFor({ rendererDir: rendererBuild() }).get("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain(`<div id="root">`);
  });

  it("serves the absolute asset URLs the Vite build emits, with honest MIME types", async () => {
    const app = appFor({ rendererDir: rendererBuild() });

    const js = await app.get("/assets/index-abc.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(await js.text()).toBe(BUNDLE_JS);

    const css = await app.get("/assets/index-abc.css");
    expect(css.headers.get("content-type")).toContain("text/css");

    const font = await app.get("/assets/dm-sans.woff2");
    expect(font.headers.get("content-type")).toContain("font/woff2");
  });

  it("ignores query strings when locating the file", async () => {
    const response = await appFor({ rendererDir: rendererBuild() }).get("/assets/index-abc.js?v=1");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(BUNDLE_JS);
  });

  it("falls back to index.html for client-side routes", async () => {
    const app = appFor({ rendererDir: rendererBuild() });
    for (const path of ["/goals/QK-WB-009", "/runs", "/deeply/nested/route"]) {
      const response = await app.get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain(`<div id="root">`);
    }
  });

  it("falls back without needing an Accept header — a curl deep link is a deep link", async () => {
    const response = await appFor({ rendererDir: rendererBuild() }).get("/goals/QK-WB-009", {
      headers: { accept: "*/*" },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`<div id="root">`);
  });

  it("404s a missing asset rather than answering it with HTML", async () => {
    const app = appFor({ rendererDir: rendererBuild() });
    for (const path of ["/assets/gone.js", "/assets/gone.css", "/favicon.ico"]) {
      const response = await app.get(path);
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).not.toContain("text/html");
      expect(await response.text()).not.toContain(`<div id="root">`);
    }
  });

  it("refuses to escape the renderer root", async () => {
    const app = appFor({ rendererDir: rendererBuild() });
    for (const path of [
      "/assets/..%2f..%2fquirks-renderer-secret.txt",
      "/%2e%2e/quirks-renderer-secret.txt",
      "/..%2f..%2fetc%2fhosts",
    ]) {
      const response = await app.get(path);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("SECRET");
    }

    // The URL parser folds `..` segments before the service ever sees them, so
    // this arrives as `/quirks-renderer-secret.txt` — a plain asset request for
    // a file that is not in the build. Same answer, different reason.
    const folded = await app.get("/assets/../../quirks-renderer-secret.txt");
    expect(folded.status).toBe(404);
    expect(await folded.text()).not.toContain("SECRET");
  });

  it("says the workbench is unbuilt instead of crashing or serving nothing", async () => {
    const app = appFor({ rendererDir: join(tmpdir(), "quirks-renderer-does-not-exist") });

    const page = await app.get("/");
    expect(page.status).toBe(503);
    expect(page.headers.get("content-type")).toContain("text/plain");
    const hint = await page.text();
    expect(hint).toContain("pnpm --filter @quirks/web build");
    expect(hint).toContain(RENDERER_DIR_ENV);

    // The API surface must work regardless — the page is missing, not the service.
    const goals = await app.get("/v1/goals");
    expect(goals.status).toBe(200);
    expect((await goals.json()).items).toEqual([]);

    // An asset request still 404s; the hint is for people, not for <script>.
    expect((await app.get("/assets/index-abc.js")).status).toBe(404);
  });
});

describe("route precedence — the renderer is the fallback, never the front", () => {
  it("leaves /v1, /health and /shape to their own routes", async () => {
    const app = appFor({ rendererDir: rendererBuild() });

    const health = await app.get("/health");
    expect(health.status).toBe(200);
    expect((await health.json()).version).toBeTypeOf("string");

    const goals = await app.get("/v1/goals");
    expect(goals.status).toBe(200);
    expect(goals.headers.get("content-type")).toContain("application/json");

    const sessions = await app.get("/v1/pty/sessions");
    expect(sessions.status).toBe(200);
    expect((await sessions.json()).sessions).toEqual([]);

    const shape = await app.get("/shape/");
    expect(shape.status).toBe(200);
    expect(await shape.text()).toContain("Waiting for the session");
  });

  it("keeps an API miss a 404, rather than answering a typo with the SPA document", async () => {
    const app = appFor({ rendererDir: rendererBuild() });
    for (const path of ["/v1/goalz", "/v1/pty/nope", "/shape/nope", "/health/nope"]) {
      const response = await app.get(path);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(`<div id="root">`);
    }
  });
});

describe("shape framing", () => {
  it("answers SAMEORIGIN so the workbench pane can frame the companion", async () => {
    const response = await appFor({ rendererDir: rendererBuild() }).get("/shape/");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    // Still refuses a cross-origin framer, and still leaks no referrer.
    expect(response.headers.get("x-frame-options")).not.toBe("ALLOWALL");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
