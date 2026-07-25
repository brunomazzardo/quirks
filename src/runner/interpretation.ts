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

import type { ReviewVerdict } from "./result-contract.js";
import type { RunnerJobFailure, RunnerJobStatus, RunnerProfile } from "./types.js";

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
  /** The exact command line the launcher ran. */
  argv: readonly string[];
  /**
   * When the launcher started this job, in epoch milliseconds.
   *
   * The artifact directory is `.quirks/briefs`, shared across every job and
   * campaign, so "a file in the artifact dir" is not the same as "a file this
   * job produced". A file older than the run is someone else's evidence.
   */
  startedAtMs: number;
}

export interface ReviewFinding {
  severity: "critical" | "important" | "minor" | "note";
  title: string;
  detail: string;
  file?: string;
  line?: number;
}

export interface InterpretedResult {
  status: RunnerJobStatus;
  verdict?: ReviewVerdict;
  /** The reviewer's own words supporting the verdict, verified against the transcript. */
  verdictEvidence?: string;
  findings?: readonly ReviewFinding[];
  /** Retained record of how this result was derived, for later audit. */
  interpretationPath?: string;
  sessionHandle: string;
  artifactPaths: readonly string[];
  failure?: RunnerJobFailure;
  notes?: readonly string[];
}

/**
 * Turns what a runner actually produced into a structured result.
 *
 * The transcript passed in is the retained, redacted one — the same text an
 * operator can read back later. Interpreting anything else would mean deriving
 * a verdict from evidence that no longer exists.
 */
export interface ResultInterpreter {
  interpret(facts: RunnerJobFacts, transcript: string): Promise<InterpretedResult>;
}
