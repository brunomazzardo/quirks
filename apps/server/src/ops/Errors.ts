// The operation errors both surfaces map: the CLI to exit 1 with the message,
// the service to an HTTP status. One vocabulary, one place.
// Ported from the bun-era src/ops/errors.ts (QK-MONO-003).

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

/** The state or revision moved underneath the request. */
export class ConflictError extends Data.TaggedError("ConflictError")<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

export const invalid = (reason: string): Effect.Effect<never, ValidationError> =>
  Effect.fail(new ValidationError({ reason }));

export const missing = (reason: string): Effect.Effect<never, NotFoundError> =>
  Effect.fail(new NotFoundError({ reason }));

export const conflict = (reason: string): Effect.Effect<never, ConflictError> =>
  Effect.fail(new ConflictError({ reason }));

/** Everything the ops layer raises that a surface must translate. */
export type OpError = ValidationError | NotFoundError | ConflictError;
