// One shape session per repo (QK-COMP-003). Screens and events live under
// .quirks/shape-sessions/current/; the quirks service serves them — no second
// process, no session-key scheme. Auth is deferred (QK-SRV-003).
//
// Ported from the bun-era src/shape/session.ts (QK-MONO-003). Self-contained
// file + SSE machinery: it reads the shape skill's frame template and helper
// from the repo, and writes only under the session directory.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { shapeSessionDir } from "../store/LedgerPaths.ts";

/** apps/server/src/shape/ → the repo root's shape skill scripts. */
const SKILL_SCRIPTS = fileURLToPath(
  new URL("../../../../.claude/skills/shape/scripts/", import.meta.url),
);

export interface ShapePaths {
  readonly sessionDir: string;
  readonly contentDir: string;
  readonly stateDir: string;
  readonly eventsFile: string;
  readonly infoFile: string;
}

export function shapePaths(root: string): ShapePaths {
  const sessionDir = shapeSessionDir(root);
  const stateDir = join(sessionDir, "state");
  return {
    sessionDir,
    contentDir: join(sessionDir, "content"),
    stateDir,
    eventsFile: join(stateDir, "events"),
    infoFile: join(stateDir, "server-info"),
  };
}

export function ensureShapeSession(root: string, url: string): ShapePaths {
  const paths = shapePaths(root);
  mkdirSync(paths.contentDir, { recursive: true });
  mkdirSync(paths.stateDir, { recursive: true });
  // Clear the stopped marker if a prior stop left one.
  try {
    unlinkSync(join(paths.stateDir, "server-stopped"));
  } catch {
    /* absent */
  }
  writeFileSync(
    paths.infoFile,
    JSON.stringify({
      url,
      screen_dir: paths.contentDir,
      state_dir: paths.stateDir,
      daemon: true,
    }) + "\n",
  );
  return paths;
}

export function endShapeSession(root: string): void {
  const paths = shapePaths(root);
  mkdirSync(paths.stateDir, { recursive: true });
  try {
    unlinkSync(paths.infoFile);
  } catch {
    /* absent */
  }
  writeFileSync(
    join(paths.stateDir, "server-stopped"),
    JSON.stringify({ reason: "session-ended", timestamp: Math.floor(Date.now() / 1000) }) + "\n",
  );
}

function isFullDocument(html: string): boolean {
  const t = html.trimStart().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html");
}

function waitingPage(): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Quirks — shape</title>
<style>
:root { --bg: #10141c; --text: #e9e4d8; --dim: #8f97a8; --lamp: #e5a83d; }
@media (prefers-color-scheme: light) {
  :root { --bg: #f3f1ea; --text: #232733; --dim: #666e7e; --lamp: #a86f12; }
}
body { background: var(--bg); color: var(--text); font: 0.9375rem/1.5 system-ui, sans-serif; min-height: 100vh; display: grid; place-items: center; margin: 0; }
.wrap { text-align: center; }
.lamp { width: 10px; height: 10px; border-radius: 50%; background: var(--lamp); margin: 0 auto 1.25rem; }
h1 { font-family: ui-monospace, Menlo, monospace; font-size: 0.85rem; letter-spacing: 0.08em; font-weight: 600; margin: 0 0 0.4rem; }
p { color: var(--dim); font-size: 0.85rem; margin: 0; }
</style>
</head>
<body><div class="wrap"><div class="lamp"></div><h1>quirks · shape</h1>
<p>Waiting for the session to push a screen…</p></div></body></html>`;
}

function brandMarkup(): string {
  return '<div class="brand"><span class="brand-copy">Quirks · shape</span></div>';
}

function loadFrameTemplate(): string {
  return readFileSync(join(SKILL_SCRIPTS, "frame-template.html"), "utf8");
}

function loadHelper(): string {
  const raw = readFileSync(join(SKILL_SCRIPTS, "helper.js"), "utf8");
  return raw.replace(/<\/script/gi, "<\\/script");
}

function wrapInFrame(content: string): string {
  return loadFrameTemplate()
    .split("<!-- BRANDING -->")
    .join(brandMarkup())
    .replace("<!-- CONTENT -->", content);
}

function newestScreen(contentDir: string): string | null {
  if (!existsSync(contentDir)) return null;
  const files = readdirSync(contentDir)
    .filter((f) => !f.startsWith(".") && f.endsWith(".html"))
    .map((f) => {
      const fp = join(contentDir, f);
      try {
        return { path: fp, mtime: statSync(fp).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x): x is { path: string; mtime: number } => x !== null)
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.path ?? null;
}

/**
 * The page the Shape pane frames, with the companion helper injected.
 *
 * `nonce` is what lets the injected helper run under the page's CSP while a
 * screen's own executable script does not. A screen is a file on disk, so this
 * is not a defense against the operator — it bounds what a badly-authored or
 * pasted-in screen can reach, on an origin that also serves /v1. The proposal
 * blocks the companion reads are `<script type="application/json">`, which is a
 * data block the browser never executes and CSP therefore never blocks.
 */
export function renderShapePage(root: string, nonce: string): string {
  const { contentDir } = shapePaths(root);
  const screen = newestScreen(contentDir);
  let html: string;
  if (screen) {
    const raw = readFileSync(screen, "utf8");
    html = isFullDocument(raw) ? raw : wrapInFrame(raw);
  } else {
    html = waitingPage();
  }
  const injection = `<script nonce="${nonce}">\n` + loadHelper() + "\n</script>";
  if (html.includes("</body>")) html = html.replace("</body>", injection + "\n</body>");
  else html += injection;
  return html;
}

/**
 * The companion's content policy. `default-src 'none'` then names exactly what
 * the page legitimately does: run the nonced helper, wear inline styles (every
 * screen is styled inline), draw same-origin fonts and data: images, and talk
 * back to its own origin over /shape/event and the SSE stream.
 *
 * `frame-ancestors 'self'` says the same thing as the X-Frame-Options header
 * beside it, for browsers that prefer the newer spelling.
 */
export function shapeContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export function pushScreen(root: string, name: string, html: string): { path: string } {
  const paths = shapePaths(root);
  mkdirSync(paths.contentDir, { recursive: true });
  mkdirSync(paths.stateDir, { recursive: true });
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+/, "") || "screen.html";
  const file = safe.endsWith(".html") ? safe : `${safe}.html`;
  const path = join(paths.contentDir, file);
  writeFileSync(path, html);
  // Fresh screen → clear prior click events (same as the old server).
  try {
    unlinkSync(paths.eventsFile);
  } catch {
    /* absent */
  }
  return { path };
}

export function readEvents(root: string): unknown[] {
  const { eventsFile } = shapePaths(root);
  if (!existsSync(eventsFile)) return [];
  return readFileSync(eventsFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { raw: line };
      }
    });
}

export function recordEvent(root: string, event: unknown): void {
  const paths = shapePaths(root);
  mkdirSync(paths.stateDir, { recursive: true });
  appendFileSync(paths.eventsFile, JSON.stringify(event) + "\n");
}

export function clearEvents(root: string): void {
  const { eventsFile } = shapePaths(root);
  try {
    unlinkSync(eventsFile);
  } catch {
    /* absent */
  }
}

export function fontPath(name: string): string | null {
  if (!name.endsWith(".woff2") || name.includes("..") || name.includes("/")) return null;
  const fp = join(SKILL_SCRIPTS, "fonts", name);
  return existsSync(fp) ? fp : null;
}

export function contentFilePath(root: string, name: string): string | null {
  if (!name || name.startsWith(".") || name.includes("..") || name.includes("/")) return null;
  const fp = join(shapePaths(root).contentDir, name);
  if (!existsSync(fp) || !statSync(fp).isFile()) return null;
  return fp;
}

/** SSE fan-out for one repo's shape session. */
export class ShapeSseHub {
  private clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private encoder = new TextEncoder();

  subscribe(): ReadableStream<Uint8Array> {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
        this.clients.add(c);
        c.enqueue(this.encoder.encode("retry: 1000\n\n"));
      },
      cancel: () => {
        this.clients.delete(controller);
      },
    });
    return stream;
  }

  broadcast(msg: unknown): void {
    const line = this.encoder.encode(`data: ${JSON.stringify(msg)}\n\n`);
    for (const c of this.clients) {
      try {
        c.enqueue(line);
      } catch {
        this.clients.delete(c);
      }
    }
  }

  get size(): number {
    return this.clients.size;
  }
}

const hubs = new Map<string, ShapeSseHub>();

export function hubFor(root: string): ShapeSseHub {
  let h = hubs.get(root);
  if (!h) {
    h = new ShapeSseHub();
    hubs.set(root, h);
  }
  return h;
}

/** Poll content/ for agent file pushes; clear events on new screens; SSE reload.
 *  Polling (not fs.watch) — FSEvents is unreliable under sandboxed / CI runners,
 *  and a shape session writes a handful of HTML files, not a torrent. */
const watchers = new Map<string, ReturnType<typeof setInterval>>();

export function startContentWatch(root: string): void {
  if (watchers.has(root)) return;
  const { contentDir, eventsFile } = shapePaths(root);
  mkdirSync(contentDir, { recursive: true });

  const known = new Map<string, number>();
  for (const f of readdirSync(contentDir).filter(
    (x) => !x.startsWith(".") && x.endsWith(".html"),
  )) {
    try {
      known.set(f, statSync(join(contentDir, f)).mtimeMs);
    } catch {
      /* race */
    }
  }

  const poll = setInterval(() => {
    let names: string[];
    try {
      names = readdirSync(contentDir).filter((x) => !x.startsWith(".") && x.endsWith(".html"));
    } catch {
      return;
    }
    let changed = false;
    const seen = new Set<string>();
    for (const f of names) {
      seen.add(f);
      let mtime: number;
      try {
        mtime = statSync(join(contentDir, f)).mtimeMs;
      } catch {
        continue;
      }
      const prev = known.get(f);
      if (prev === undefined) {
        known.set(f, mtime);
        try {
          unlinkSync(eventsFile);
        } catch {
          /* absent */
        }
        changed = true;
      } else if (prev !== mtime) {
        known.set(f, mtime);
        changed = true;
      }
    }
    for (const f of known.keys()) {
      if (!seen.has(f)) known.delete(f);
    }
    if (changed) hubFor(root).broadcast({ type: "reload" });
  }, 200);
  if (typeof poll.unref === "function") poll.unref();
  watchers.set(root, poll);
}

export function stopContentWatch(root: string): void {
  const w = watchers.get(root);
  if (w) {
    clearInterval(w);
    watchers.delete(root);
  }
}

export function notifyScreenChange(root: string): void {
  hubFor(root).broadcast({ type: "reload" });
}
