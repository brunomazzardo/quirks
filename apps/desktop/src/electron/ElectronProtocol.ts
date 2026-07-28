// The Electron half of the renderer scheme. Kept apart from
// app/DesktopProtocol.ts so the request-mapping rules stay importable (and
// testable) without an Electron runtime — the same split t3code draws between
// src/electron/* and src/app/*.

import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { net, protocol } from "electron";

import {
  DESKTOP_SCHEME,
  resolveRendererRequest,
  type RendererRequestResolution,
} from "../app/DesktopProtocol.ts";

/**
 * Must run before `app.whenReady()`. `standard` gives the scheme a real origin
 * (so relative asset URLs and history routing resolve); `secure` puts it in a
 * secure context, which the renderer needs for crypto and storage APIs.
 */
export function registerDesktopSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: DESKTOP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

function toResponse(resolution: RendererRequestResolution): Promise<Response> | Response {
  if (resolution._tag === "NotFound") {
    return new Response(null, { status: 404, statusText: resolution.reason });
  }

  // net.fetch derives the content type from the file extension, which is the
  // whole reason not to hand-roll a static file server here.
  return net.fetch(pathToFileURL(resolution.path).toString());
}

/** Registers the handler that serves `quirks://app/...` out of `rendererDir`. */
export function handleDesktopScheme(rendererDir: string): void {
  protocol.handle(DESKTOP_SCHEME, (request) =>
    toResponse(
      resolveRendererRequest({
        rendererDir,
        requestUrl: request.url,
        fileExists: (path) => existsSync(path),
      }),
    ),
  );
}
