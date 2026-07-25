import { spawn } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildClaudeEnv } from "../claude.js";
import type {
  InterpretedResult,
  ResultInterpreter,
  ReviewFinding,
  RunnerJobFacts,
} from "../interpretation.js";
import { interpretationPath } from "../result-contract.js";
import { transcriptSessionHandle } from "../transcript.js";
import type { RunnerJobFailure, RunnerJobStatus } from "../types.js";
import {
  MANAGING_AGENT_BRIEF_VERSION,
  MANAGING_AGENT_SYSTEM_BRIEF,
  buildInterpretationPrompt,
} from "./brief.js";
import { MANAGING_AGENT_MODEL, type InterpreterConfig } from "./config.js";
import {
  MANAGING_AGENT_RESULT_SCHEMA,
  parseManagingAgentReport,
  quoteSupportedByTranscript,
  type ManagingAgentReport,
} from "./contract.js";

/**
 * The managing agent: one sonnet subprocess per job that reads the retained
 * transcript and reports what the runner said.
 *
 * Everything it reports is checked against evidence Quirks holds: the quote
 * behind a verdict must appear in the transcript, claimed artifact paths must
 * exist inside the job's own directories, the session handle is read from the
 * transcript rather than taken on trust, and a non-zero exit can never be
 * reported as success. What is left for the model is reading — which is the
 * part no parser could do, and the part `--output-schema` was destroying.
 */

const MAX_AGENT_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_FILES_LISTED = 100;
const MAX_FAILURE_MESSAGE_CHARS = 2048;
/** One retry, then fail with the transcript kept (owner decision 2). */
const MAX_INTERPRETATION_ATTEMPTS = 2;

export interface AgentSpawnInput {
  argv: readonly string[];
  stdin: string;
  timeoutMs: number;
  env?: Readonly<Record<string, string>>;
}

export interface AgentSpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type SpawnAgent = (input: AgentSpawnInput) => Promise<AgentSpawnResult>;

/**
 * The minimal-surface launch, measured on 2026-07-25 against claude 2.1.220.
 *
 * A default `claude -p` inherits the operator's MCP servers, plugins, skills,
 * and settings: 23,174 cache-creation tokens and $0.145 for one interpretation.
 * With these flags the tool list is exactly ["StructuredOutput"], nothing else
 * is loaded, and the same call costs $0.0049. Disabling every tool also makes
 * the read-only posture mechanical rather than promised — this agent cannot
 * touch the repository, the task ledger, or campaign state, because it has no
 * means to.
 */
export function buildInterpreterArgv(
  config: InterpreterConfig,
  systemBrief: string,
): readonly string[] {
  return [
    config.executable,
    "-p",
    "--model", config.model,
    "--output-format", "json",
    "--json-schema", JSON.stringify(MANAGING_AGENT_RESULT_SCHEMA),
    "--system-prompt", systemBrief,
    // No tools at all. The transcript arrives in the prompt; nothing is read
    // from disk, so nothing can be written to it either.
    "--tools", "",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--disable-slash-commands",
    "--setting-sources", "",
    "--no-session-persistence",
  ];
}

function collectBounded(stdout: string, maxBytes: number): string {
  return Buffer.byteLength(stdout, "utf8") > maxBytes ? stdout.slice(0, maxBytes) : stdout;
}

const defaultSpawnAgent: SpawnAgent = async (input) => {
  const executable = input.argv[0];
  if (executable === undefined) {
    throw new Error("Managing-agent argv must include an executable");
  }
  return new Promise<AgentSpawnResult>((resolve, reject) => {
    const child = spawn(executable, input.argv.slice(1), {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      ...(input.env !== undefined ? { env: { ...process.env, ...input.env } } : {}),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      if (!settled) {
        settled = true;
        reject(new Error(`Managing agent exceeded ${input.timeoutMs}ms`));
      }
    }, input.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          exitCode: code,
          stdout: collectBounded(stdout, MAX_AGENT_STDOUT_BYTES),
          stderr: stderr.slice(-4096),
        });
      }
    });
    // The job prompt goes on stdin: argv is world-visible in `ps`, and a real
    // transcript would otherwise land there in full.
    child.stdin?.end(input.stdin);
  });
};

interface AgentEvent {
  type?: unknown;
  subtype?: unknown;
  is_error?: unknown;
  result?: unknown;
  structured_output?: unknown;
}

/**
 * Read the agent's own envelope: `-p --output-format json` emits a JSON array
 * of events whose terminal `result` carries the validated `structured_output`.
 */
function readAgentReport(stdout: string): { report: ManagingAgentReport } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return { error: `the managing agent did not return JSON (${stdout.trim().slice(0, 200) || "empty output"})` };
  }
  const events: AgentEvent[] = Array.isArray(parsed)
    ? parsed.filter((entry): entry is AgentEvent => typeof entry === "object" && entry !== null)
    : typeof parsed === "object" && parsed !== null
      ? [parsed as AgentEvent]
      : [];
  const terminal = events.filter((event) => event.type === "result").pop();
  if (!terminal) {
    return { error: "the managing agent produced no terminal result event" };
  }
  if (terminal.is_error === true) {
    const detail = typeof terminal.result === "string" ? terminal.result : String(terminal.subtype ?? "error");
    return { error: `the managing agent reported an error: ${detail.slice(0, 500)}` };
  }
  const report = parseManagingAgentReport(terminal.structured_output);
  if (!report) {
    return { error: "the managing agent's answer did not match the required result schema" };
  }
  return { report };
}

async function listArtifactFiles(artifactDir: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(artifactDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(artifactDir, entry.name))
      .toSorted()
      .slice(0, MAX_ARTIFACT_FILES_LISTED);
  } catch {
    return [];
  }
}

function withinDirectory(candidate: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Keep only paths that exist and belong to this job.
 *
 * A model can name a file that was never written, and a path outside the job's
 * own directories is not this job's evidence even when it exists. Verifying
 * with `stat` is strictly stronger than asking the agent to look, which is why
 * it is given no filesystem access at all.
 */
async function verifiedArtifactPaths(
  claimed: readonly string[],
  facts: RunnerJobFacts,
): Promise<{ kept: string[]; dropped: string[] }> {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const candidate of claimed) {
    const inScope = withinDirectory(candidate, facts.artifactDir)
      || withinDirectory(candidate, facts.worktreePath);
    if (!inScope) {
      dropped.push(candidate);
      continue;
    }
    try {
      const stats = await stat(candidate);
      if (stats.isFile()) kept.push(candidate);
      else dropped.push(candidate);
    } catch {
      dropped.push(candidate);
    }
  }
  return { kept, dropped };
}

interface ReconciledResult {
  status: RunnerJobStatus;
  verdict: InterpretedResult["verdict"];
  verdictEvidence: string | undefined;
  findings: readonly ReviewFinding[];
  artifactPaths: readonly string[];
  sessionHandle: string;
  failure: RunnerJobFailure | undefined;
  notes: readonly string[];
  checks: {
    quoteSupported: boolean;
    exitCodeOverride: boolean;
    droppedArtifactPaths: readonly string[];
  };
}

type Reconciliation =
  | { kind: "ok"; reconciled: ReconciledResult }
  | { kind: "reject"; reason: string };

async function reconcile(
  report: ManagingAgentReport,
  facts: RunnerJobFacts,
  transcript: string,
): Promise<Reconciliation> {
  let verdict: InterpretedResult["verdict"];
  let verdictEvidence: string | undefined;
  let quoteSupported = false;

  if (facts.role === "reviewer") {
    if (report.verdict === "accept" || report.verdict === "revise") {
      if (!quoteSupportedByTranscript(report.verdictEvidence, transcript)) {
        // The whole traceability rule lives here: a verdict we cannot find in
        // the runner's own words is not a verdict. Failing closed is what keeps
        // an invented accept from landing work nobody approved.
        return {
          kind: "reject",
          reason:
            "the quote you gave in verdictEvidence does not appear in the transcript. Quote the reviewer's own words verbatim and contiguously, or answer \"indeterminate\".",
        };
      }
      verdict = report.verdict;
      verdictEvidence = report.verdictEvidence;
      quoteSupported = true;
    } else {
      // Absent, null, or explicitly undetermined: all withhold acceptance.
      verdict = "indeterminate";
    }
  }

  let status = report.status;
  const notes: string[] = [];
  let failure: RunnerJobFailure | undefined = report.failure === null
    ? undefined
    : { code: report.failure.code, message: report.failure.message.slice(0, MAX_FAILURE_MESSAGE_CHARS) };

  const exitCodeOverride = facts.exitCode !== 0 && status === "success";
  if (exitCodeOverride) {
    // A green result over a non-zero exit is the mirror of "a green exit code is
    // not a green result", and the same rule applies: the mechanical fact wins.
    status = "failure";
    notes.push("exit_code_override");
    failure ??= {
      code: "non_zero_exit",
      message: facts.exitCode === null
        ? "Runner was terminated by a signal but its output was read as success"
        : `Runner exited with code ${facts.exitCode} but its output was read as success`,
    };
  }

  if (status !== "success" && failure === undefined) {
    failure = { code: "runner_error", message: report.summary.slice(0, MAX_FAILURE_MESSAGE_CHARS) };
  }

  const artifacts = await verifiedArtifactPaths(report.artifactPaths, facts);

  return {
    kind: "ok",
    reconciled: {
      status,
      verdict,
      verdictEvidence,
      findings: report.findings,
      artifactPaths: artifacts.kept,
      sessionHandle: transcriptSessionHandle(transcript) ?? facts.sessionId ?? report.sessionHandle ?? "",
      failure,
      notes,
      checks: {
        quoteSupported,
        exitCodeOverride,
        droppedArtifactPaths: artifacts.dropped,
      },
    },
  };
}

interface InterpretationRecord {
  schemaVersion: 1;
  jobId: string;
  role: RunnerJobFacts["role"];
  runner: { profileId: string; runnerType: string; model: string };
  interpreterModel: string;
  briefVersion: number;
  transcriptPath: string | undefined;
  transcriptBytes: number;
  report: ManagingAgentReport | null;
  verdict: InterpretedResult["verdict"] | null;
  checks: {
    quoteSupported: boolean;
    exitCodeOverride: boolean;
    droppedArtifactPaths: readonly string[];
    attempts: number;
    rejections: readonly string[];
  };
  at: string;
}

export class ManagingAgentInterpreter implements ResultInterpreter {
  constructor(
    private readonly config: InterpreterConfig,
    private readonly spawnAgent: SpawnAgent = defaultSpawnAgent,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async interpret(facts: RunnerJobFacts, transcript: string): Promise<InterpretedResult> {
    const artifactFiles = await listArtifactFiles(facts.artifactDir);
    const argv = buildInterpreterArgv(this.config, MANAGING_AGENT_SYSTEM_BRIEF);
    const env = buildClaudeEnv(this.config.configDir ? { configDir: this.config.configDir } : {});
    const rejections: string[] = [];
    let corrective: string | undefined;

    for (let attempt = 1; attempt <= MAX_INTERPRETATION_ATTEMPTS; attempt += 1) {
      const prompt = buildInterpretationPrompt({
        facts,
        transcript,
        artifactFiles,
        excerptBudgetBytes: this.config.excerptBudgetBytes,
        ...(corrective !== undefined ? { corrective } : {}),
      });

      let spawned: AgentSpawnResult;
      try {
        spawned = await this.spawnAgent({
          argv,
          stdin: prompt,
          timeoutMs: this.config.wallClockMs,
          ...(env !== undefined ? { env } : {}),
        });
      } catch (error) {
        rejections.push(error instanceof Error ? error.message : "the managing agent could not be run");
        corrective = undefined;
        continue;
      }

      if (spawned.exitCode !== 0) {
        rejections.push(
          `the managing agent exited with code ${spawned.exitCode ?? "null"}: ${spawned.stderr.trim().slice(0, 500) || "no stderr"}`,
        );
        corrective = undefined;
        continue;
      }

      const read = readAgentReport(spawned.stdout);
      if ("error" in read) {
        rejections.push(read.error);
        corrective = read.error;
        continue;
      }

      const outcome = await reconcile(read.report, facts, transcript);
      if (outcome.kind === "reject") {
        rejections.push(outcome.reason);
        corrective = outcome.reason;
        continue;
      }

      const recordPath = await this.retainRecord(facts, transcript, read.report, {
        ...outcome.reconciled.checks,
        attempts: attempt,
        rejections,
      }, outcome.reconciled.verdict ?? null);

      const { reconciled } = outcome;
      return {
        status: reconciled.status,
        ...(reconciled.verdict !== undefined ? { verdict: reconciled.verdict } : {}),
        ...(reconciled.verdictEvidence !== undefined ? { verdictEvidence: reconciled.verdictEvidence } : {}),
        ...(reconciled.findings.length > 0 ? { findings: reconciled.findings } : {}),
        ...(recordPath !== undefined ? { interpretationPath: recordPath } : {}),
        sessionHandle: reconciled.sessionHandle,
        artifactPaths: recordPath !== undefined
          ? [...reconciled.artifactPaths, recordPath]
          : reconciled.artifactPaths,
        ...(reconciled.failure !== undefined ? { failure: reconciled.failure } : {}),
        ...(reconciled.notes.length > 0 ? { notes: reconciled.notes } : {}),
      };
    }

    return this.failedInterpretation(facts, transcript, rejections);
  }

  /**
   * Both attempts failed. The job fails and the work does not: the transcript
   * is on disk, so a human can read exactly what the runner said and decide.
   * There is deliberately no fallback to a schema path — with `--output-schema`
   * dropped there is no envelope left to parse (owner decision 2).
   */
  private async failedInterpretation(
    facts: RunnerJobFacts,
    transcript: string,
    rejections: readonly string[],
  ): Promise<InterpretedResult> {
    const unsupportedVerdict = rejections.every((reason) => reason.includes("does not appear in the transcript"));
    const recordPath = await this.retainRecord(facts, transcript, null, {
      quoteSupported: false,
      exitCodeOverride: false,
      droppedArtifactPaths: [],
      attempts: MAX_INTERPRETATION_ATTEMPTS,
      rejections,
    }, null);

    return {
      status: "failure",
      sessionHandle: transcriptSessionHandle(transcript) ?? facts.sessionId ?? "",
      artifactPaths: recordPath !== undefined ? [recordPath] : [],
      ...(recordPath !== undefined ? { interpretationPath: recordPath } : {}),
      failure: {
        code: unsupportedVerdict && rejections.length > 0 ? "unsupported_verdict" : "interpretation_failed",
        message: `Managing agent could not interpret this job after ${MAX_INTERPRETATION_ATTEMPTS} attempts: ${
          rejections.join(" | ").slice(0, MAX_FAILURE_MESSAGE_CHARS)
        }`,
      },
      notes: ["interpretation_failed"],
    };
  }

  private async retainRecord(
    facts: RunnerJobFacts,
    transcript: string,
    report: ManagingAgentReport | null,
    checks: InterpretationRecord["checks"],
    verdict: InterpretedResult["verdict"] | null,
  ): Promise<string | undefined> {
    const record: InterpretationRecord = {
      schemaVersion: 1,
      jobId: facts.jobId,
      role: facts.role,
      runner: { profileId: facts.profileId, runnerType: facts.runnerType, model: facts.model },
      interpreterModel: MANAGING_AGENT_MODEL,
      briefVersion: MANAGING_AGENT_BRIEF_VERSION,
      transcriptPath: facts.transcriptPath,
      transcriptBytes: Buffer.byteLength(transcript, "utf8"),
      report,
      verdict,
      checks,
      at: this.now(),
    };
    const target = interpretationPath(facts.artifactDir, facts.jobId);
    try {
      await mkdir(facts.artifactDir, { recursive: true });
      // 0600 like the transcript: this record embeds quotes from it.
      await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      return target;
    } catch {
      // Losing the audit record must not lose the result; the transcript still
      // stands on its own.
      return undefined;
    }
  }
}
