import { QuirksError, type QuirksErrorCode } from "../core/errors.js";

export const MAX_JSON_BYTES = 1_048_576;

export type ExitCode = 0 | 1 | 2 | 3 | 4;

export function exitCodeForError(error: unknown): ExitCode {
  if (error instanceof QuirksError) {
    if (error.code === "SOURCE_UNAVAILABLE") return 4;
    if (
      error.code === "SCHEMA_INVALID" ||
      error.code === "PROTOCOL_VIOLATION" ||
      error.code === "STALE_REVISION" ||
      error.code === "SOURCE_CONFLICT" ||
      error.code === "UNSUPPORTED_VERSION" ||
      error.code === "INVALID_REPOSITORY_PATH" ||
      error.code === "INVALID_JSON_VALUE" ||
      error.code === "SECRET_REJECTED"
    ) {
      return 3;
    }
  }
  return 1;
}

export function domainErrorCode(error: unknown): QuirksErrorCode | "INTERNAL" {
  if (error instanceof QuirksError) return error.code;
  return "INTERNAL";
}

export function writeJson(stdout: NodeJS.WriteStream, value: unknown): void {
  const payload = JSON.stringify(value);
  if (Buffer.byteLength(payload, "utf8") > MAX_JSON_BYTES) {
    throw new QuirksError("PROTOCOL_VIOLATION", "CLI JSON output exceeds size limit");
  }
  stdout.write(`${payload}\n`);
}

export function writeHuman(
  stdout: NodeJS.WriteStream,
  lines: readonly string[],
): void {
  for (const line of lines) {
    stdout.write(`${line}\n`);
  }
}

export function formatFreshness(syncedAt: string): string {
  return syncedAt;
}

export function localCoordinationLine(driver: string): string | undefined {
  return driver === "json" ? "Local coordination only" : undefined;
}
