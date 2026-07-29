// Reading a JSON request body, once, for every /v1 route.
//
// There were two of these. `http/Routes.ts` had `body`/`field<T>`/`str`/`bool`/
// `list` and `pty/Routes.ts` had `body`/`str`/`num`/`strList`/`envRecord` —
// the same job, written twice, at two different levels of rigor. The pty kit
// checked element types; the other did not, and its two weakest readers were
// the ones handling the most consequential fields:
//
//   field<T>(input, "ifRevision")  // a bare `as T`: "seven" arrives typed number
//   list(input, "taskIds")         // `unknown[] as string[]`: [1,2] arrives typed string[]
//
// A cast is not a check. Both flowed into the ops layer already wearing the type
// they had failed to be, so the first thing to notice was whatever broke
// downstream. These readers answer `undefined` for anything that is not the type
// asked for, which is the answer the route already knows how to handle.
//
// The request TYPES live in @quirks/contracts and are imported by the routes, so
// server and web cannot drift on a body shape without the compiler saying so —
// which is the entire reason a contracts package exists.

import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http";

/** The parsed body, or null when there wasn't one. */
export const body: Effect.Effect<
  Record<string, unknown> | null,
  unknown,
  HttpServerRequest.HttpServerRequest
> = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return (yield* request.json) as Record<string, unknown> | null;
});

export type Body = Record<string, unknown> | null;

export const str = (source: Body, key: string): string | undefined => {
  const value = source?.[key];
  return typeof value === "string" ? value : undefined;
};

/** Finite numbers only: `NaN` and `Infinity` survive `typeof === "number"` and
 *  then poison every comparison they reach. */
export const num = (source: Body, key: string): number | undefined => {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

export const int = (source: Body, key: string): number | undefined => {
  const value = num(source, key);
  return value !== undefined && Number.isInteger(value) ? value : undefined;
};

export const bool = (source: Body, key: string): boolean | undefined => {
  const value = source?.[key];
  return typeof value === "boolean" ? value : undefined;
};

/** Element-checked. A caller that sends `[1, 2]` gets the entries it actually
 *  sent as strings — none — rather than numbers wearing a string type. */
export const strList = (source: Body, key: string): string[] | undefined => {
  const value = source?.[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
};

/** Same, but absent reads as empty — the shape most list fields want. */
export const strListOr = (source: Body, key: string): string[] => strList(source, key) ?? [];

export const envRecord = (source: Body, key: string): Record<string, string> | undefined => {
  const value = source?.[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [name, item] of Object.entries(value)) {
    if (typeof item === "string") out[name] = item;
  }
  return out;
};

/** One of a fixed set, or `undefined`. Keeps a body from naming a runner, mode
 *  or state that does not exist and having it carried as though it did. */
export const oneOf = <const T extends string>(
  source: Body,
  key: string,
  allowed: readonly T[],
): T | undefined => {
  const value = str(source, key);
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
};
