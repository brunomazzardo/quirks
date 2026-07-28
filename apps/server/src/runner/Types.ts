// Transport-level job result. Verdict / quote verification is QK-RUN-004 —
// this layer only knows whether the process ran, timed out, or flooded.
// Ported from the bun-era src/runner/types.ts (QK-MONO-005).
//
// `RunnerKind` now comes from @quirks/contracts: the ledger persists it on every
// RunDispatchRecord, so the runner set and the wire contract are one definition.

import type { RunnerKind } from "@quirks/contracts";

export type { RunnerKind };

/** The runners quirks looks for, in the fixed preference order routing uses. */
export const ALL_RUNNERS: readonly RunnerKind[] = ["claude", "codex", "cursor"];

/** Transport status — never a judgment of the work. */
export type DispatchStatus = "success" | "failure" | "timeout" | "cancelled";

export interface DispatchFailure {
  readonly code: string;
  readonly message: string;
}

export interface DispatchResult {
  readonly jobId: string;
  readonly runner: RunnerKind;
  readonly status: DispatchStatus;
  readonly exitCode: number | null;
  /** Absolute path of the retained transcript, when anything was written. */
  readonly transcriptPath: string | null;
  readonly durationMs: number;
  readonly failure?: DispatchFailure;
  readonly notes?: readonly string[];
}

/** What the parent reads back: the transport result plus, when it could be read,
 *  the retained transcript the quote interpreter checks a verdict against. */
export interface DispatchOutcome extends DispatchResult {
  readonly transcript?: string;
}

/** A non-zero exit is never durable terminal success. */
export function statusFromExit(exitCode: number | null, timedOut: boolean): DispatchStatus {
  if (timedOut) return "timeout";
  if (exitCode === 0) return "success";
  return "failure";
}
