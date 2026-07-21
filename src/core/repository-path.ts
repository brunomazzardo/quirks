import path from "node:path";
import { QuirksError } from "./errors.js";

export function assertRepositoryRelativePath(value: string): string {
  const normalized = path.posix.normalize(value);
  if (
    value.length === 0 || value.includes("\0") || value.includes("\\") ||
    path.posix.isAbsolute(value) || normalized !== value ||
    normalized === ".." || normalized.startsWith("../")
  ) {
    throw new QuirksError("INVALID_REPOSITORY_PATH", `Unsafe repository path: ${JSON.stringify(value)}`);
  }
  return normalized;
}
