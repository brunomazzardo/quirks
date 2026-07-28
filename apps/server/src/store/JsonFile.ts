// The one place that reads and writes the ledger's JSON files.
//
// Ported from the bun-era src/store/json-file.ts (QK-MONO-003). The two carried
// defects live here and are not negotiable:
//   - a corrupt file is NEVER treated as empty (v1's QK-RUN-012 class), and
//   - absence is a normal outcome, distinguishable from every other failure.

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";

/** A corrupt store file. Never treated as empty: replacing a corrupt ledger with
 *  a fresh one silently destroys the backlog (v1's QK-RUN-012 class). */
export class StoreCorruptError extends Data.TaggedError("StoreCorruptError")<{
  readonly path: string;
  readonly detail: string;
}> {
  override get message(): string {
    return (
      `corrupt store file: ${this.path}\n  ${this.detail}\n` +
      `  Refusing to treat it as empty. Repair or remove the file yourself.`
    );
  }
}

/** Everything a store read or write can fail with. `PlatformError` is a write
 *  that could not land; `StoreCorruptError` is a read that must not be believed. */
export type StoreError = StoreCorruptError | PlatformError.PlatformError;

/**
 * Reads and parses a JSON file. `Option.none()` is a normal outcome (the file is
 * absent); unreadable or unparseable is a loud, distinct failure.
 *
 * EACCES, EISDIR, … deliberately do NOT read as absence: absence of readable
 * data is not evidence of an empty store.
 */
export const loadJsonFile = (
  path: string,
): Effect.Effect<Option.Option<unknown>, StoreCorruptError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(path, "utf8").pipe(
      Effect.map(Option.some<string>),
      Effect.catch((error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed(Option.none<string>())
          : Effect.fail(new StoreCorruptError({ path, detail: `unreadable: ${error.message}` })),
      ),
    );
    if (Option.isNone(raw)) return Option.none();
    return yield* Effect.try({
      try: () => Option.some(JSON.parse(raw.value) as unknown),
      catch: (err) =>
        new StoreCorruptError({ path, detail: `invalid JSON: ${(err as Error).message}` }),
    });
  });

/** Writes via temp file + rename so a reader never sees a torn file. */
export const saveJsonFile = (
  path: string,
  data: unknown,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    yield* fs.makeDirectory(pathService.dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    yield* fs.writeFileString(tmp, JSON.stringify(data, null, 2) + "\n");
    yield* fs.rename(tmp, path);
  });
