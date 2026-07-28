// Shared shape of the /v1 wire: paging, query coercion, and the one place
// operation failures become HTTP statuses.
//
// The status table is the bun-era `app.onError` verbatim (src/service/app.ts):
//   400 validation, 404 not found, 409 conflict/transition, 500 store corruption.
// A corrupt ledger is a 500 carrying the corrupt teaching — never an empty list.

import * as Effect from "effect/Effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
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

export const searchParams: Effect.Effect<
  Readonly<Record<string, string | ReadonlyArray<string>>>,
  never,
  HttpServerRequest.ParsedSearchParams
> = HttpServerRequest.ParsedSearchParams;

export const json = (body: unknown, status = 200): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.jsonUnsafe(body, { status });

export const jsonError = (message: string, status: number): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.jsonUnsafe({ error: message }, { status });

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

/** The three routes whose machinery ports in QK-MONO-005. They exist, and they
 *  refuse loudly rather than pretending to work. */
export const notPortedYet: HttpServerResponse.HttpServerResponse = jsonError(
  "ported in QK-MONO-005",
  501,
);
