// The one way this app talks to the daemon (QK-WB-003's fetch, lifted out of
// state/ledger.ts when QK-WB-007 added a second reader).
//
// Everything is requested SAME-ORIGIN (lib/service.ts): in dev the Vite proxy
// forwards /v1 to the daemon. A cross-origin fetch could not read these
// responses at all — the daemon sets no CORS headers.

import type { Page } from "@quirks/contracts";
import * as Effect from "effect/Effect";

import { serviceBaseUrl } from "~/lib/service";

/** Page size per request. The routes default to 100 (apps/server http/Routes.ts). */
const PAGE_LIMIT = 200;

/** A backstop so a pathological `total` cannot spin the loop forever. */
const MAX_PAGES = 25;

export function asError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  return new Error(String(cause));
}

/** One GET, decoded, with a bad status treated as the down-signal: through the
 *  dev proxy a stopped daemon surfaces as a 5xx from Vite rather than a
 *  rejected fetch, so the status is what says "not reachable". */
export const fetchJson = <T>(path: string): Effect.Effect<T, Error> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(`${serviceBaseUrl()}${path}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error(`GET ${path} → HTTP ${response.status}`);
      return (await response.json()) as T;
    },
    catch: asError,
  });

/** Walk `?offset=&limit=` until the reported total is in hand (D6 paginates). */
export const fetchAll = <T>(path: string): Effect.Effect<T[], Error> =>
  Effect.gen(function* () {
    const separator = path.includes("?") ? "&" : "?";
    const items: T[] = [];
    for (let request = 0; request < MAX_PAGES; request += 1) {
      const page = yield* fetchJson<Page<T>>(
        `${path}${separator}offset=${items.length}&limit=${PAGE_LIMIT}`,
      );
      items.push(...page.items);
      if (page.items.length === 0 || items.length >= page.total) break;
    }
    return items;
  });
