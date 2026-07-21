import type { RunnerJobStatus } from "../runner/types.js";

export const failureClasses = [
  "task_rejection",
  "honest_partial",
  "transient_runner",
  "usage_limit",
  "permission_denial",
  "fabricated_evidence",
  "wedge_after_work",
  "task_source_conflict",
  "task_source_outage",
  "ambiguous_mutation",
  "integration_failure",
  "pre_push_landing_failure",
  "post_push_ambiguity",
  "crash_restart",
] as const;

export type FailureClass = typeof failureClasses[number];

export interface FailureClassificationInput {
  status: RunnerJobStatus;
  retryable?: boolean;
  reason?: string;
  failure?: { code?: string; message?: string } | undefined;
}

export interface RetryPolicyInput {
  retriesUsed: number;
  usageLimitReset: boolean;
}

const failureClassSet: ReadonlySet<string> = new Set(failureClasses);

export function classifyFailure(result: FailureClassificationInput): FailureClass {
  if (result.status === "usage_limit") {
    return "usage_limit";
  }
  if (result.status === "permission_denied") {
    return "permission_denial";
  }
  if (result.retryable || result.status === "timeout" || result.status === "cancelled") {
    return "transient_runner";
  }

  const explicit = result.reason ?? result.failure?.code;
  if (explicit && isFailureClass(explicit)) {
    return explicit;
  }

  return "task_rejection";
}

export function shouldRetryFailure(failureClass: FailureClass, input: RetryPolicyInput): boolean {
  if (failureClass === "transient_runner") {
    return input.retriesUsed < 1;
  }
  if (failureClass === "usage_limit") {
    return input.usageLimitReset;
  }
  return false;
}

function isFailureClass(value: string): value is FailureClass {
  return failureClassSet.has(value);
}
