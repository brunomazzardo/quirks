// Shared shape of the /v1 wire: paging, query coercion, and the one place
// operation failures become HTTP statuses.
//
// The status table is the bun-era `app.onError` verbatim (src/service/app.ts):
//   400 validation, 404 not found, 409 conflict/transition, 500 store corruption.
// A corrupt ledger is a 500 carrying the corrupt teaching — never an empty list.

import * as Effect from "effect/Effect";
import type { unhandled } from "effect/Types";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { Page } from "@quirks/contracts";
import { StoreCorruptError } from "../store/JsonFile.ts";
import { TransitionError } from "../store/Transitions.ts";
import { ConflictError, NotFoundError, ValidationError } from "../ops/Errors.ts";

/** Paginate a list route: ?offset=&limit= (native-app budgets force it — the
 *  real v1 ledger sat at 82% of the 256 KiB fetch ceiling). */
export function page<T>(items: readonly T[], offset: number, limit: number): Page<T> {
  return {
    total: items.length,
    offset,
    limit,
    items: items.slice(offset, offset + limit),
  };
}

export function intParam(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** First value of a repeated query parameter — the bun-era `c.req.query(k)`. */
export function queryOne(
  params: Readonly<Record<string, string | ReadonlyArray<string>>>,
  key: string,
): string | undefined {
  const raw = params[key];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : (raw as string);
}

/** A route path parameter. Absent is impossible for a matched route, but the
 *  router types it as optional — refuse rather than coerce. */
export const pathParam = (key: string): Effect.Effect<string, never, HttpRouter.RouteContext> =>
  Effect.map(HttpRouter.params, (params) => params[key] ?? "");

export const searchParams: Effect.Effect<
  Readonly<Record<string, string | ReadonlyArray<string>>>,
  never,
  HttpServerRequest.ParsedSearchParams
> = HttpServerRequest.ParsedSearchParams;

export const json = (body: unknown, status = 200): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.jsonUnsafe(body, { status });

export const jsonError = (message: string, status: number): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.jsonUnsafe({ error: message }, { status });

// ---------------------------------------------------------------------------
// the same-origin guard
// ---------------------------------------------------------------------------

/** Reading these changes nothing, so a cross-origin caller may attempt them —
 *  it still cannot read the answer, because the daemon sends no CORS headers. */
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The hosts a quirks client can legitimately be served from.
 *
 * The boundary is LOOPBACK, not "the host this request named". Comparing
 * `Origin` against the `Host` header looks tighter and is in fact both weaker
 * and wrong: `Host` is client-supplied, and any reverse proxy rewrites it —
 * apps/web's dev proxy sets `changeOrigin: true`, so in `pnpm dev` `Host`
 * becomes the daemon while `Origin` stays `http://localhost:5733`, and every
 * write from the dev workbench would be refused.
 *
 * A page cannot give itself a loopback origin. Reaching one means something is
 * already running on this machine and serving it, which is a position from
 * which the ledger was never defended anyway (FOUNDING: local single-user tool).
 * What this refuses is the actual threat: a page on the open internet.
 */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
]);

/** Opaque origins (the literal `null` a sandboxed frame sends) do not parse and
 *  are therefore refused — which is the correct answer for them anyway. */
function isLoopbackOrigin(origin: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * Can this request change something?
 *
 * NOT the same question as "is the method unsafe". `GET
 * /v1/pty/sessions/:id/socket` upgrades to a WebSocket whose `input` and
 * `resize` frames go straight to the shell — and WebSockets obey neither the
 * same-origin policy nor preflight, so a hostile page can open one and type.
 * Keying off the verb alone left the exec surface open through the one door
 * that does not look like a write.
 */
function mayChangeSomething(method: string, upgrade: string | undefined): boolean {
  if (!SAFE_METHODS.has(method)) return true;
  return upgrade?.toLowerCase().includes("websocket") === true;
}

/**
 * Refuse a state-changing request that came from another origin.
 *
 * THE LOOPBACK BIND IS NOT THE BOUNDARY IT READS AS. Three facts compose into a
 * remote shell on the operator's machine:
 *
 *  1. `request.json` parses the body whatever the content type says, so a POST
 *     sent as `text/plain` is a CORS *simple* request — the browser sends it
 *     with no preflight to ask permission of.
 *  2. Nothing looked at `Origin`, so the daemon could not tell its own workbench
 *     from any page in any tab.
 *  3. The port is `45000 + sha256(root) % 15000` (service/Machine.ts) — a
 *     15,000-wide range a page can spray in seconds, fire-and-forget.
 *
 * The response is still discarded for want of CORS headers, and for reads that
 * genuinely is the end of it — the reasoning in http/Renderer.ts and
 * apps/web/vite.config.ts is sound as far as it goes. It does not go as far as
 * side effects: `POST /v1/pty/sessions` spawns a shell from caller-supplied
 * `shell`/`args`/`cwd`/`env`, and an attacker who never reads a byte has still
 * run a command. Before QK-WB-004 the surface had no exec primitive; it does now.
 *
 * A browser attaches `Origin` to every cross-origin POST, so comparing it to the
 * host that was asked closes the hole. Absence means a non-browser caller — the
 * CLI, `curl`, the harness — which no page can drive.
 *
 * This is NOT the auth FOUNDING.md defers to QK-SRV-003: no identity, no token,
 * no capability, nothing to configure. It is the loopback assumption the rest of
 * the design already rests on, made true.
 */
export const originGuard = HttpRouter.middleware(
  Effect.succeed((httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, unhandled>) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (!mayChangeSomething(request.method, request.headers["upgrade"])) {
        return yield* httpEffect;
      }
      const origin = request.headers["origin"];
      if (origin === undefined || isLoopbackOrigin(origin)) return yield* httpEffect;
      return jsonError(
        `cross-origin ${request.method} refused — quirks serves loopback origins only`,
        403,
      );
    }),
  ),
  { global: true },
);

/**
 * The route error boundary. Every /v1 handler ends here, so there is exactly one
 * table mapping a failure to a status — the same property the bun-era
 * `app.onError` had.
 */
export const respond = <E, R>(
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  handler.pipe(
    Effect.catch((error: E): Effect.Effect<HttpServerResponse.HttpServerResponse> => {
      if (error instanceof ValidationError) return Effect.succeed(jsonError(error.message, 400));
      if (error instanceof NotFoundError) return Effect.succeed(jsonError(error.message, 404));
      if (error instanceof ConflictError || error instanceof TransitionError) {
        return Effect.succeed(jsonError(error.message, 409));
      }
      if (error instanceof StoreCorruptError) return Effect.succeed(jsonError(error.message, 500));
      // Anything else is a real fault: report it, never dress it as success.
      return Effect.logError("unhandled service failure", { error }).pipe(
        Effect.as(jsonError(error instanceof Error ? error.message : String(error), 500)),
      );
    }),
  );
