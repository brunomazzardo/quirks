import { readFile } from "node:fs/promises";
import { parseClaudeResult, claudeArtifactPaths, claudeResultPath } from "./claude.js";
import { parseCodexResult } from "./codex.js";
import { parseCursorResult, cursorResultPath } from "./cursor.js";
import type { InterpretedResult, ResultInterpreter, RunnerJobFacts } from "./interpretation.js";
import { parseReviewVerdict, type ReviewVerdict } from "./result-contract.js";
import type { RunnerJobStatus } from "./types.js";

/**
 * The strict-envelope path, as one implementation of the interpretation seam.
 *
 * This is today's behavior moved behind the port unchanged, so the managing
 * agent can be introduced beside it and the change stays bisectable. It is
 * scheduled for deletion once the agent path carries real traffic: keeping two
 * live result paths means keeping two sets of fakes faithful, which is exactly
 * the condition that let the test suite stay green through six real dispatch
 * defects (QK-RUN-009, owner decision 3).
 */
export class SchemaResultInterpreter implements ResultInterpreter {
  async interpret(facts: RunnerJobFacts, transcript: string): Promise<InterpretedResult> {
    const sessionFallback = facts.sessionId ?? "";

    switch (facts.runnerType) {
      case "claude": {
        const parsed = parseClaudeResult(transcript, {
          exitCode: facts.exitCode ?? 1,
          artifactPaths: claudeArtifactPaths(facts.artifactDir, facts.jobId),
          ...(facts.sessionId !== undefined ? { sessionId: facts.sessionId } : {}),
        });
        // The claude CLI cannot enforce the envelope, so the verdict is read
        // back from the brief-declared file the job wrote.
        const verdict = await readClaudeVerdict(claudeResultPath(facts.artifactDir, facts.jobId));
        return {
          status: parsed.status,
          ...(verdict !== undefined ? { verdict } : {}),
          sessionHandle: parsed.sessionHandle || sessionFallback,
          artifactPaths: parsed.artifactPaths,
          ...(parsed.failure !== undefined
            ? { failure: { code: parsed.failure.code, message: parsed.failure.message } }
            : {}),
        };
      }
      case "codex": {
        const declaredResultPath = codexDeclaredResultPath(facts.argv);
        if (!declaredResultPath) {
          return {
            status: "failure",
            sessionHandle: sessionFallback,
            artifactPaths: [],
            failure: {
              code: "missing_result_path",
              message: "Codex argv did not declare a result artifact path",
            },
          };
        }

        const parsed = parseCodexResult(
          transcript,
          { declaredResultPath, files: await readDeclaredArtifactFiles(declaredResultPath) },
          { requireWorkArtifacts: facts.capabilities.includes("repository-write") },
        );

        return {
          status: parsed.status,
          ...(parsed.verdict !== undefined ? { verdict: parsed.verdict } : {}),
          sessionHandle: parsed.sessionHandle ?? sessionFallback,
          artifactPaths: parsed.artifactPaths,
          ...(parsed.failure !== undefined
            ? { failure: { code: codexFailureCode(parsed.status), message: parsed.failure } }
            : {}),
          ...(parsed.notes.length > 0 ? { notes: parsed.notes } : {}),
        };
      }
      case "cursor": {
        // Cursor has no --output-schema/-o equivalent, so the brief instructs
        // the agent to write the envelope to the job-unique declared path and
        // the parser validates it strictly.
        const declaredResultPath = cursorResultPath(facts.artifactDir, facts.jobId);
        const parsed = parseCursorResult(
          transcript,
          { declaredResultPath, files: await readDeclaredArtifactFiles(declaredResultPath) },
          { requireWorkArtifacts: facts.capabilities.includes("repository-write") },
        );
        return {
          status: parsed.status,
          ...(parsed.verdict !== undefined ? { verdict: parsed.verdict } : {}),
          sessionHandle: parsed.sessionHandle ?? sessionFallback,
          artifactPaths: parsed.artifactPaths,
          ...(parsed.failure !== undefined
            ? {
                failure: {
                  code: parsed.failure.reason,
                  message: parsed.failure.detail ?? parsed.failure.reason,
                },
              }
            : {}),
        };
      }
      default: {
        const exhaustive: never = facts.runnerType;
        return exhaustive;
      }
    }
  }
}

export function codexDeclaredResultPath(argv: readonly string[]): string | undefined {
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "-o" && argv[index + 1]) {
      return argv[index + 1];
    }
  }
  return undefined;
}

async function readDeclaredArtifactFiles(
  declaredResultPath: string,
): Promise<Readonly<Record<string, string>>> {
  try {
    const contents = await readFile(declaredResultPath, "utf8");
    return { [declaredResultPath]: contents };
  } catch {
    return {};
  }
}

async function readClaudeVerdict(envelopePath: string): Promise<ReviewVerdict | undefined> {
  try {
    const parsed = JSON.parse(await readFile(envelopePath, "utf8")) as { verdict?: unknown };
    return parseReviewVerdict(parsed.verdict);
  } catch {
    return undefined;
  }
}

function codexFailureCode(status: RunnerJobStatus): string {
  if (status === "usage_limit") return "usage_limit";
  if (status === "cancelled") return "interrupted";
  return "runner_error";
}
