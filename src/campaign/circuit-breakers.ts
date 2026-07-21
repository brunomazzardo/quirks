export type CircuitBreakerAction = "continue" | "pause_lane" | "pause_campaign" | "hold" | "stop";

export interface CircuitBreakerInput {
  laneFailureThreshold: number;
  consecutiveLaneFailures: number;
  integrationFailure: boolean;
  envelopeDrift: boolean;
  usageLimitWithoutReset: boolean;
  budgetExceeded?: boolean;
  taskRevisionDrift?: boolean;
  ambiguousAcceptedOrPushed?: boolean;
}

export interface CircuitBreakerDecision {
  action: CircuitBreakerAction;
  reason: string;
}

export function evaluateCircuitBreakers(input: CircuitBreakerInput): CircuitBreakerDecision {
  if (input.budgetExceeded) {
    return { action: "stop", reason: "BUDGET_EXCEEDED" };
  }
  if (input.ambiguousAcceptedOrPushed) {
    return { action: "hold", reason: "AMBIGUOUS_ACCEPTED_OR_PUSHED_STATE" };
  }
  if (input.integrationFailure) {
    return { action: "pause_campaign", reason: "INTEGRATION_FAILURE" };
  }
  if (input.envelopeDrift || input.taskRevisionDrift) {
    return { action: "pause_campaign", reason: "REVISION_DRIFT" };
  }
  if (input.usageLimitWithoutReset) {
    return { action: "pause_lane", reason: "USAGE_LIMIT_WITHOUT_RESET" };
  }
  if (input.consecutiveLaneFailures >= input.laneFailureThreshold) {
    return { action: "pause_lane", reason: "LANE_FAILURE_THRESHOLD" };
  }
  return { action: "continue", reason: "OK" };
}
