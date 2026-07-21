export type QuirksErrorCode =
  | "INVALID_JSON_VALUE"
  | "INVALID_REPOSITORY_PATH"
  | "SCHEMA_INVALID"
  | "UNSUPPORTED_VERSION"
  | "STALE_REVISION"
  | "SOURCE_CONFLICT"
  | "SOURCE_UNAVAILABLE"
  | "PROTOCOL_VIOLATION"
  | "SECRET_REJECTED";

export class QuirksError extends Error {
  override readonly name = "QuirksError";

  constructor(
    readonly code: QuirksErrorCode,
    message: string,
    readonly details: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }
}
