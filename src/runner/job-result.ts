import type { RunnerJobFailure, RunnerJobResult } from "./types.js";

export function normalizeJobResult(input: {
  jobId: string;
  profileId: string;
  runnerType: "claude" | "codex" | "cursor";
  resolvedModel: string;
  effort: string;
  status: RunnerJobResult["status"];
  sessionHandle: string;
  artifactPaths: readonly string[];
  failure?: RunnerJobFailure;
}): RunnerJobResult {
  return {
    schemaVersion: 1,
    jobId: input.jobId,
    runner: input.profileId,
    runnerType: input.runnerType,
    resolvedModel: input.resolvedModel,
    effort: input.effort,
    status: input.status,
    sessionHandle: input.sessionHandle,
    artifactPaths: [...input.artifactPaths],
    usage: {},
    ...(input.failure !== undefined ? { failure: input.failure } : {}),
  };
}
