import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";

export function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
