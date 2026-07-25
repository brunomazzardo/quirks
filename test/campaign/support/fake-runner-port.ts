import type { ResolvedRoute } from "../../../src/campaign/routing.js";
import type { RunnerPort as CampaignRunnerPort } from "../../../src/campaign/ports.js";
import type { RunnerJobResult } from "../../../src/runner/types.js";

export interface FakeRunnerDispatch {
  jobId: string;
  taskId: string;
  role: "supervisor" | "implementer" | "reviewer";
  route: ResolvedRoute;
  briefPath: string;
  worktreePath: string;
}

export class FakeRunnerPort implements CampaignRunnerPort {
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
      // A reviewer must say it approves, and quote itself saying so:
      // acceptance is never inferred from a silent success, and never granted
      // to a verdict with nothing behind it. The default models an approving
      // reviewer so existing happy-path tests keep their meaning, while a test
      // that wants a withheld approval queues an explicit revise, an absent
      // verdict, or an accept with no evidence.
      ...(input.role === "reviewer"
        ? {
            verdict: "accept" as const,
            verdictEvidence: "Accept as it stands. I found nothing that must be fixed before this lands.",
          }
        : {}),
      sessionHandle: "fake-session",
      artifactPaths: [],
      usage: {},
      failure: undefined,
    };
  }
}
