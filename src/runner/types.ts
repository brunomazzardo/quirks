import type { JudgmentTier } from "../campaign/types.js";

export interface RunnerProfile {
  schemaVersion: 1;
  profileId: string;
  runnerType: "claude" | "codex" | "cursor";
  executable: string;
  accountAlias: string;
  quotaPoolId: string;
  tier: JudgmentTier;
  model: string;
  effort: JudgmentTier;
  capabilities: readonly string[];
  wallClockMs: number;
  configDir?: string;
  redactionRules: readonly string[];
}

export interface HostProfile {
  schemaVersion: 1;
  hostType: "claude-code" | "codex" | "cursor";
  version: string;
  identitySummary?: string;
}

export type RunnerJobStatus =
  | "success"
  | "failure"
  | "cancelled"
  | "timeout"
  | "usage_limit"
  | "permission_denied";

export interface RunnerJobFailure {
  code: string;
  message: string;
}

export interface RunnerJobResult {
  schemaVersion: 1;
  jobId: string;
  runner: string;
  runnerType: RunnerProfile["runnerType"];
  resolvedModel: string;
  effort: string;
  status: RunnerJobStatus;
  sessionHandle: string;
  artifactPaths: readonly string[];
  usage: Readonly<Record<string, number>>;
  failure: RunnerJobFailure | undefined;
}
