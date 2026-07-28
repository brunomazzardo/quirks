// What code is this process actually running? (QK-SRV-006)
//
// A long-lived daemon can serve code that no longer exists in the working
// tree, and — before this module — nothing could tell you. That is not merely
// inconvenient: it makes the CLI misreport which code produced a result, which
// is the honesty property, not a comfort.
//
// Dependency-free on purpose: every app may import it.

import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Never acted upon — see the fail-open rule below. */
export const UNKNOWN_FINGERPRINT = "unknown";

export interface CodeIdentity {
  /** Hex digest, or UNKNOWN_FINGERPRINT when it could not be computed. */
  fingerprint: string;
  /** What was measured. `unknown` means: do not act on this. */
  source: "src" | "executable" | "unknown";
  /** How many files went into the digest. */
  files: number;
  /** The directory measured, when `source` is "src". */
  dir: string | null;
}

/** The directory this module was loaded from — a snapshot measures itself. */
export function ownSourceDir(): string {
  return fileURLToPath(new URL(".", import.meta.url));
}

function collectSources(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      // Never descend into a snapshot: it would make the digest depend on
      // previous digests, and grow without bound.
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) found.push(full);
    }
  };
  walk(dir);
  // Sorted so the digest is a property of the tree, not of directory order.
  return found.sort();
}

/**
 * Digest `(relative path, size, mtimeMs)` for every `.ts` file under `dir`.
 * No file contents are read, so this stays a few milliseconds even though every
 * CLI invocation pays for it. A touched-but-unchanged file yields a new digest;
 * that is a false "drifted", which costs a warning — the opposite error, missing
 * a real change, is the one that costs afternoons.
 */
export function fingerprintDir(dir: string): CodeIdentity {
  const files = collectSources(dir);
  if (files.length === 0) {
    return { fingerprint: UNKNOWN_FINGERPRINT, source: "unknown", files: 0, dir };
  }
  const hash = createHash("sha256");
  for (const file of files) {
    const stat = statSync(file);
    hash.update(`${relative(dir, file)} ${stat.size} ${stat.mtimeMs}\n`);
  }
  return {
    fingerprint: hash.digest("hex").slice(0, 32),
    source: "src",
    files: files.length,
    dir,
  };
}

/**
 * The identity of the code at `dir`, falling back to the running executable
 * when there is no source tree (a compiled binary has none).
 *
 * **Fail open.** Anything unmeasurable returns `unknown`, and callers must never
 * act on `unknown` — restarting on ignorance is inventing a fact, and is exactly
 * how a restart loop starts.
 */
export function codeIdentity(dir: string = ownSourceDir()): CodeIdentity {
  try {
    const fromSource = fingerprintDir(dir);
    if (fromSource.source === "src") return fromSource;
  } catch {
    /* fall through to the executable */
  }
  try {
    const stat = statSync(process.execPath);
    const hash = createHash("sha256")
      .update(`${process.execPath} ${stat.size} ${stat.mtimeMs}`)
      .digest("hex");
    return {
      fingerprint: hash.slice(0, 32),
      source: "executable",
      files: 1,
      dir: null,
    };
  } catch {
    return { fingerprint: UNKNOWN_FINGERPRINT, source: "unknown", files: 0, dir: null };
  }
}

/** True only when both sides are known AND differ. Ignorance is never drift. */
export function hasDrifted(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a === UNKNOWN_FINGERPRINT || b === UNKNOWN_FINGERPRINT) return false;
  return a !== b;
}
