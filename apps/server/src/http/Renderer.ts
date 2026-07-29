// The workbench, served from the service's own origin (QK-WB-009).
//
// t3code's arrangement: the process that owns the API also serves the built web
// app, so a packaged/desktop workbench is SINGLE-ORIGIN. That is not a
// convenience — it is what makes the page readable at all. The daemon sets no
// CORS headers (loopback-only tool, by design), so a cross-origin `fetch` to
// /v1 receives the bytes and then discards them for want of
// Access-Control-Allow-Origin.
//
// READS ONLY, THOUGH. A discarded response still leaves whatever the request
// did behind it, which is why writes are refused by `originGuard` in
// ./Wire.ts rather than by the absence of CORS headers.
// apps/web already assumes this: `serviceBaseUrl()`
// is `""` and Vite's dev proxy exists only to fake the same property in dev.
// Serving the renderer here retires the proxy for every non-dev launch.
//
// THIS LAYER IS THE FALLBACK, NEVER THE FRONT. It registers `GET /*`, which
// find-my-way ranks below every static and parametric route, so /v1/*, /shape/*,
// /health, /shutdown and the pty socket keep winning on their own paths. Only
// paths no route claims reach the renderer.
//
// Resolution is `HttpStaticServer` from effect/unstable/http rather than a
// hand-rolled walk: the platform already refuses traversal, resolves MIME types,
// answers byte ranges, and honors If-None-Match / If-Modified-Since against an
// ETag it computes from the file. What it does NOT have is the two rules
// apps/desktop/src/app/DesktopProtocol.ts spells out for the quirks:// scheme —
// and this module adds both:
//
//   - a request that names an extension and misses is a 404, never HTML
//     (answering a missing .js with index.html turns a 404 into a MIME error);
//   - anything else falls back to index.html, because client-side routes have
//     no file behind them.
//
// It also adds two rules that only exist because the API shares this origin:
//
//   - a miss under a service prefix (/v1, /shape, /health, /shutdown) stays a
//     404 rather than becoming the SPA document — an API typo must not answer
//     with HTML;
//   - a renderer that has not been built answers with a build hint instead of
//     nothing. The API surface works either way; only the page is missing, and
//     the person looking at a blank tab should be told why.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpPlatform, NodeServices } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import {
  HttpRouter,
  type HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/unstable/http";
import { jsonError, respond } from "./Wire.ts";

/** Points the service at a renderer build somewhere other than the workspace's. */
export const RENDERER_DIR_ENV = "QUIRKS_RENDERER_DIR";
export const RENDERER_INDEX_FILE = "index.html";

/**
 * Path prefixes the service owns. A miss underneath one of these is an API
 * mistake, so it answers 404 rather than falling through to the SPA document —
 * a caller who typos `/v1/goalz` must not have to notice that the 200 they got
 * back is HTML.
 */
const SERVICE_PREFIXES = ["/v1", "/shape", "/health", "/shutdown"] as const;

const isServicePath = (pathname: string): boolean =>
  SERVICE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

/**
 * The workspace build: `apps/web/dist`, relative to this file rather than to a
 * cwd the daemon does not control.
 *
 * `fileURLToPath`, not `URL.pathname` — the same reason App.ts gives for
 * PROCESS_CODE: a checkout under a path with a space yields `%20` from
 * `pathname`, and every subsequent join silently addresses a directory that
 * does not exist.
 */
export const defaultRendererDir = (): string =>
  fileURLToPath(new URL("../../../web/dist", import.meta.url));

/**
 * Where the renderer lives, in precedence order: an explicit argument (tests),
 * then `QUIRKS_RENDERER_DIR`, then the workspace build.
 *
 * The env override is the packaging seam. A packaged app ships the renderer
 * beside the server rather than at `apps/web/dist`, and points at it by setting
 * this variable when it spawns the daemon — no code change here.
 */
export const resolveRendererDir = (
  override?: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string => {
  const configured = (override ?? env[RENDERER_DIR_ENV])?.trim();
  return configured ? resolve(configured) : defaultRendererDir();
};

/** The request path, less the query string. */
const pathnameOf = (url: string): string => {
  const query = url.indexOf("?");
  return query === -1 ? url : url.slice(0, query);
};

/** No renderer on disk. The API is unaffected, so say so and say how to fix it. */
const notBuilt = (dir: string): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.text(
    [
      "The Quirks workbench has not been built.",
      "",
      `Expected a renderer build at: ${dir}`,
      "",
      "Build it:   pnpm --filter @quirks/web build",
      `Or point elsewhere:  ${RENDERER_DIR_ENV}=/path/to/dist`,
      "",
      "The service itself is fine — /v1, /shape and /health answer as usual.",
      "",
    ].join("\n"),
    {
      status: 503,
      contentType: "text/plain; charset=utf-8",
      headers: { "Cache-Control": "no-store" },
    },
  );

export interface RendererOptions {
  /** Overrides the env var and the workspace default. Tests pass a temp dir. */
  readonly rendererDir?: string | undefined;
}

/**
 * The static catch-all, as a router layer.
 *
 * Deliberately NOT inside `HttpRouter.provideRequest(servicesLayer)` in App.ts:
 * the router reads its middleware from the context at registration time, so
 * routes registered by a sibling layer carry none of it. Serving a file needs no
 * ledger, no store and no pty registry, and this keeps it that way.
 */
export const rendererRoutes = (
  options: RendererOptions = {},
): Layer.Layer<never, never, HttpRouter.HttpRouter> => {
  const dir = resolveRendererDir(options.rendererDir);

  return HttpRouter.use((router) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const indexPath = path.join(dir, RENDERER_INDEX_FILE);

      // Files only. `index` and `spa` are BOTH off on purpose: the platform's
      // SPA fallback fires only when the request also sends `Accept: text/html`,
      // and its directory-index rule would give `/` a second, differently
      // cached route to the same bytes. Every delivery of index.html therefore
      // goes through `document` below — one path, one set of headers, and a deep
      // link answers the document whatever asked for it, exactly as
      // DesktopProtocol does on quirks:// where there is no Accept to consult.
      //
      // No `cacheControl` either: the platform already emits ETag and
      // Last-Modified, so a reload of a bundle costs a 304 rather than a body,
      // and a single directive cannot be right for both a content-hashed asset
      // and the index that names it.
      const serveStatic = yield* HttpStaticServer.make({
        root: dir,
        index: undefined,
        spa: false,
      });

      /**
       * The SPA document, re-read per request. It is ~1.5 KiB, and reading it
       * fresh means a rebuilt renderer is live without restarting the daemon —
       * the property `pnpm --filter @quirks/web build` against a running service
       * depends on.
       */
      const document: Effect.Effect<
        HttpServerResponse.HttpServerResponse,
        PlatformError.PlatformError
      > = fs.readFileString(indexPath).pipe(
        Effect.map((html) =>
          HttpServerResponse.text(html, {
            contentType: "text/html; charset=utf-8",
            headers: { "Cache-Control": "no-store" },
          }),
        ),
        Effect.catch(
          (
            error,
          ): Effect.Effect<HttpServerResponse.HttpServerResponse, PlatformError.PlatformError> =>
            error.reason._tag === "NotFound" ? Effect.succeed(notBuilt(dir)) : Effect.fail(error),
        ),
      );

      const unmatched: Effect.Effect<
        HttpServerResponse.HttpServerResponse,
        PlatformError.PlatformError | HttpServerError.HttpServerError,
        HttpServerRequest.HttpServerRequest
      > = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const pathname = pathnameOf(request.url);
        if (isServicePath(pathname)) return jsonError(`no such route: ${pathname}`, 404);
        if (path.extname(pathname) !== "") {
          return HttpServerResponse.text(`no such asset: ${pathname}\n`, {
            status: 404,
            contentType: "text/plain; charset=utf-8",
          });
        }
        return yield* document;
      });

      const handler = serveStatic.pipe(
        Effect.catch(
          (
            error,
          ): Effect.Effect<
            HttpServerResponse.HttpServerResponse,
            PlatformError.PlatformError | HttpServerError.HttpServerError,
            HttpServerRequest.HttpServerRequest
          > =>
            error.reason._tag === "RouteNotFound"
              ? unmatched
              : // A real IO fault — permissions, a directory where a file was
                // expected — is a 500 through `respond`, never a silent 404.
                Effect.fail(error),
        ),
      );

      // One registration, and it is the lowest-priority shape find-my-way has.
      // `/*` covers the bare root as well as everything beneath it, and loses to
      // every static and parametric route regardless of which layer registered
      // first — which is what lets App.ts merge this beside the API rather than
      // having to order it.
      yield* router.add("GET", "/*", respond(handler));
    }).pipe(
      // `HttpStaticServer.make` declares PlatformError but only reads services;
      // there is no failure to handle, and a layer that cannot fail keeps the
      // daemon's `Layer.build` error channel honest (ServeError only).
      Effect.orDie,
    ),
  ).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, NodeHttpPlatform.layer)));
};
