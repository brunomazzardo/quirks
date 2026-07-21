import type { ResolvedRoute } from "../../../src/campaign/routing.js";
import type { RunnerJobResult } from "../../../src/runner/types.js";

export interface RunnerPort {
  dispatch(input: {
    jobId: string;
    taskId: string;
    role: "supervisor" | "implementer" | "reviewer";
    route: ResolvedRoute;
    briefPath: string;
    worktreePath: string;
  }): Promise<RunnerJobResult>;
}

export interface FakeRunnerDispatch {
  jobId: string;
  taskId: string;
  role: "supervisor" | "implementer" | "reviewer";
  route: ResolvedRoute;
  briefPath: string;
  worktreePath: string;
}

export class FakeRunnerPort implements RunnerPort {
  readonly dispatches: FakeRunnerDispatch[] = [];
  private readonly results = new Map<string, RunnerJobResult>();
  private defaultResult: RunnerJobResult | undefined;

  queueResult(jobId: string, result: RunnerJobResult): void {
    this.results.set(jobId, result);
  }

  setDefaultResult(result: RunnerJobResult): void {
    this.defaultResult = result;
  }

  async dispatch(input: FakeRunnerDispatch): Promise<RunnerJobResult> {
    this.dispatches.push({ ...input });
    return this.results.get(input.jobId) ?? this.defaultResult ?? {
      schemaVersion: 1,
      jobId: input.jobId,
      runner: input.route.profileId,
      runnerType: input.route.runnerType,
      resolvedModel: "test-model",
      effort: input.route.effort,
      status: "success",
      sessionHandle: "fake-session",
      artifactPaths: [],
      usage: {},
      failure: undefined,
    };
  }
}
