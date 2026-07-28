// Serves the built renderer over a custom scheme instead of file://.
//
// Mirrors t3code's src/electron/ElectronProtocol.ts: the workbench always
// loads from `<scheme>://app/`, never from a filesystem URL. It has to.
// apps/web builds with Vite's default base, so index.html asks for
// `/assets/index-*.js`; under file:// that resolves to the filesystem root and
// the window comes up blank. A standard scheme gives the renderer a real
// origin, which also keeps localStorage, service workers and history routing
// behaving the way they do against the dev server.
//
// Trimmed from t3code: they proxy the scheme to their backend's HTTP origin
// (single-origin Clerk sessions); Quirks has no backend behind the renderer
// yet, so the handler reads files off disk. No CSP header either — the shell
// has no remote origins to constrain, and QK-WB-006/007 will define the real
// policy once the workbench talks to the local server.

import * as NodePath from "node:path";

export const DESKTOP_SCHEME = "quirks";
export const DESKTOP_HOST = "app";
export const DESKTOP_ORIGIN = `${DESKTOP_SCHEME}://${DESKTOP_HOST}`;
export const DESKTOP_URL = `${DESKTOP_ORIGIN}/`;
export const RENDERER_INDEX_FILE = "index.html";

export type RendererRequestResolution =
  | { readonly _tag: "File"; readonly path: string }
  | { readonly _tag: "NotFound"; readonly reason: string };

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + NodePath.sep);
}

/**
 * Maps a `quirks://app/...` request onto a file in the renderer directory.
 *
 * Pure so the interesting cases — traversal attempts, SPA deep links, missing
 * assets — are testable without an Electron session.
 */
export function resolveRendererRequest(input: {
  readonly rendererDir: string;
  readonly requestUrl: string;
  readonly fileExists: (path: string) => boolean;
}): RendererRequestResolution {
  let url: URL;
  try {
    url = new URL(input.requestUrl);
  } catch {
    return { _tag: "NotFound", reason: `unparseable request url: ${input.requestUrl}` };
  }

  if (url.host !== DESKTOP_HOST) {
    return { _tag: "NotFound", reason: `unexpected host: ${url.host}` };
  }

  const rendererDir = NodePath.resolve(input.rendererDir);
  const indexPath = NodePath.join(rendererDir, RENDERER_INDEX_FILE);

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return { _tag: "NotFound", reason: `undecodable path: ${url.pathname}` };
  }

  const requested = NodePath.resolve(rendererDir, `.${NodePath.posix.resolve("/", pathname)}`);
  if (!isWithin(rendererDir, requested)) {
    return { _tag: "NotFound", reason: `path escapes the renderer root: ${pathname}` };
  }

  if (requested !== rendererDir && input.fileExists(requested)) {
    return { _tag: "File", path: requested };
  }

  // Client-side routes have no file behind them, so anything that does not look
  // like an asset falls back to index.html. Requests that name an extension do
  // not: answering a missing .js with HTML only turns a 404 into a MIME error.
  if (requested !== rendererDir && NodePath.extname(requested) !== "") {
    return { _tag: "NotFound", reason: `no such asset: ${pathname}` };
  }

  return input.fileExists(indexPath)
    ? { _tag: "File", path: indexPath }
    : { _tag: "NotFound", reason: `renderer index is missing: ${indexPath}` };
}
