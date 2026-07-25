import type {
  InterpretedResult,
  ResultInterpreter,
  RunnerJobFacts,
} from "../../../src/runner/interpretation.js";

/**
 * A stand-in for the managing agent, for tests about layers above it.
 *
 * There is exactly one interpretation path in production, and this is not a
 * second one: it never parses a runner's output, it returns whatever the test
 * scripts. That distinction matters. The fakes that drifted from reality were
 * fakes of a *contract* — they imitated envelopes real CLIs were supposed to
 * write, and stayed green while the real ones wrote nothing of the sort. The
 * interpretation itself is tested against transcripts captured from the real
 * binaries (test/fixtures/real-transcripts) and gated by the real-CLI probe.
 */
export class StubInterpreter implements ResultInterpreter {
  readonly facts: RunnerJobFacts[] = [];
  readonly transcripts: string[] = [];

  constructor(
    private readonly reply: (facts: RunnerJobFacts, transcript: string) => InterpretedResult =
    () => ({ status: "success", sessionHandle: "stub-session", artifactPaths: [] }),
  ) {}

  async interpret(facts: RunnerJobFacts, transcript: string): Promise<InterpretedResult> {
    this.facts.push(facts);
    this.transcripts.push(transcript);
    return this.reply(facts, transcript);
  }
}
