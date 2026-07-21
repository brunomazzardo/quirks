import { QuirksError } from "./errors.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function normalize(value: unknown, path: string, ancestors: WeakSet<object>): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new QuirksError("INVALID_JSON_VALUE", `Cycle at ${path}`);
    ancestors.add(value);
    const output = value.map((item, index) => normalize(item, `${path}[${index}]`, ancestors));
    ancestors.delete(value);
    return output;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new QuirksError("INVALID_JSON_VALUE", `Non-plain object at ${path}`);
    }
    if (ancestors.has(value)) throw new QuirksError("INVALID_JSON_VALUE", `Cycle at ${path}`);
    ancestors.add(value);
    const input = value as Record<string, unknown>;
    const output: Record<string, Json> = {};
    for (const key of Object.keys(input).toSorted()) output[key] = normalize(input[key], `${path}.${key}`, ancestors);
    ancestors.delete(value);
    return output;
  }
  throw new QuirksError("INVALID_JSON_VALUE", `Non-JSON value at ${path}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, "$", new WeakSet()));
}
