/**
 * The result-interpretation seam.
 *
 * The launcher knows how to start a vendor CLI correctly and nothing about the
 * shape of what it produces; an interpreter turns whatever the CLI actually
 * produced into the structured result Quirks needs. Keeping the two apart is
 * what lets the CLI speak naturally: the 2026-07-24 measurement was that
 * constraining codex's final message to an envelope removed its reasoning
 * entirely (0 prose messages with `--output-schema`, 8 without).
 */

import type { RunnerProfile } from "./types.js";

/**
 * What the launcher observed, stated by Quirks rather than by any model.
 *
 * Everything here is a fact the launcher owns: it built the argv, it spawned
 * the child, it read the exit code, it wrote the transcript. An interpreter is
 * given these and never asked to rediscover them.
 */
export interface RunnerJobFacts {
  jobId: string;
  role: "supervisor" | "implementer" | "reviewer";
  runnerType: RunnerProfile["runnerType"];
  profileId: string;
  model: string;
  capabilities: readonly string[];
  /** null when the child was terminated by a signal rather than exiting. */
  exitCode: number | null;
  artifactDir: string;
  worktreePath: string;
  /** Path to the retained, redacted transcript, absent only when nothing was written. */
  transcriptPath: string | undefined;
  /** Session id the launcher generated, where the CLI takes one. */
  sessionId: string | undefined;
}

export interface ReviewFinding {
  severity: "critical" | "important" | "minor" | "note";
  title: string;
  detail: string;
  file?: string;
  line?: number;
}
