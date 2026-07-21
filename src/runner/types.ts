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

export interface RunnerJobResult {
  schemaVersion: 1;
  jobId: string;
  status: RunnerJobStatus;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  sessionId?: string;
  summary?: string;
  evidence: Readonly<Record<string, string>>;
}
