// What lives under `.quirks/`, enumerated once.
//
// CLAUDE.md: "Only the store boundary (apps/server) touches it; never add a
// second path in." The package boundary held — nothing outside apps/server
// reaches into the ledger — but inside it four modules had each spelled
// `join(root, ".quirks", …)` by hand: run artifacts, shape sessions,
// continuation briefs, and the bun-era daemon record. Four spellings of one
// rule is how the fifth one ends up somewhere nobody looks.
//
// `Store.dir` remains the authority for the ledger's own files (goals, tasks,
// runs). These are the directories BESIDE them, and this is the file to read to
// learn that they exist.
//
// Server-side only: the CLI reaches data over HTTP (D4) and may not import this.

import { join } from "node:path";

/** The committed ledger directory, relative to a repo root. */
export const LEDGER_DIR = ".quirks";

export const ledgerDir = (root: string): string => join(root, LEDGER_DIR);

/** Per-run, per-task artifacts: the brief a runner read, its transcripts. */
export const runArtifactDir = (root: string, runId: string, taskId: string): string =>
  join(ledgerDir(root), "runs", runId, taskId);

/** The shape companion's session — screens pushed, events recorded. */
export const shapeSessionDir = (root: string): string =>
  join(ledgerDir(root), "shape-sessions", "current");

/** A continuation brief is written into the TASK'S WORKTREE, not the repo root:
 *  it is addressed to whoever picks the work up there. */
export const continuationPath = (worktree: string, taskId: string): string =>
  join(ledgerDir(worktree), "continuations", `${taskId}.md`);

// The bun era's daemon record (`.quirks/service/daemon.json`) is deliberately
// NOT here. cli/Daemon.ts still reads it so an old daemon can be found and
// stopped, and D4 forbids the CLI importing anything under store/ — so that one
// path stays spelled out at its only call site.
