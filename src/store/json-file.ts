import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** A corrupt store file. Never treated as empty: replacing a corrupt ledger with a
 *  fresh one silently destroys the backlog (v1's QK-RUN-012 class). */
export class StoreCorruptError extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(
      `corrupt store file: ${path}\n  ${detail}\n` +
        `  Refusing to treat it as empty. Repair or remove the file yourself.`,
    );
    this.name = "StoreCorruptError";
  }
}

export const ABSENT: unique symbol = Symbol("absent");

/** Reads and parses a JSON file. Absent is a normal outcome; unreadable or
 *  unparseable is a loud, distinct one. */
export function loadJsonFile(path: string): unknown | typeof ABSENT {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return ABSENT;
    // EACCES, EISDIR, …: absence of readable data is not evidence of an empty store.
    throw new StoreCorruptError(path, `unreadable: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new StoreCorruptError(path, `invalid JSON: ${(err as Error).message}`);
  }
}

/** Writes via temp file + rename so a reader never sees a torn file. */
export function saveJsonFile(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}
