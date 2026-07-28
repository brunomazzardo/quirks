// Transport-level job result. Verdict / quote verification is QK-RUN-004 —
// this layer only knows whether the process ran, timed out, or flooded.

export type RunnerKind = "claude" | "codex" | "cursor";

/** Transport status — never a judgment of the work. */
export type DispatchStatus = "success" | "failure" | "timeout" | "cancelled";

export interface DispatchFailure {
  code: string;
  message: string;
}

export interface DispatchResult {
  jobId: string;
  runner: RunnerKind;
  status: DispatchStatus;
  exitCode: number | null;
  /** Absolute path of the retained transcript, when anything was written. */
  transcriptPath: string | null;
  durationMs: number;
  failure?: DispatchFailure;
  notes?: string[];
}

/** A non-zero exit is never durable terminal success. */
export function statusFromExit(exitCode: number | null, timedOut: boolean): DispatchStatus {
  if (timedOut) return "timeout";
  if (exitCode === 0) return "success";
  return "failure";
}
