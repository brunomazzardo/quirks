import type { RunnerJobFailure, RunnerJobResult } from "./types.js";

export interface NormalizeJobResultInput {
  jobId: string;
  profileId: string;
  runnerType: RunnerJobResult["runnerType"];
  resolvedModel: string;
  effort: string;
  status: RunnerJobResult["status"];
  sessionHandle: string;
  artifactPaths: readonly string[];
  usage?: RunnerJobResult["usage"];
  failure?: RunnerJobFailure | undefined;
  notes?: readonly string[];
}

export function normalizeJobResult(input: NormalizeJobResultInput): RunnerJobResult {
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
    usage: { ...input.usage },
    failure: input.failure,
    ...(input.notes !== undefined && input.notes.length > 0 ? { notes: [...input.notes] } : {}),
  };
}
