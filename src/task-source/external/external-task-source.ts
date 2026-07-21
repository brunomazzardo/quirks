import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { QuirksError } from "../../core/errors.js";
import {
  assertMutationIdentity,
  parseTaskSourceRequest,
  parseTaskSourceResponse,
  type TaskSource,
} from "../task-source.js";
import type { TaskSourceRequest, TaskSourceResponse } from "../types.js";
import { createScrubbedEnvironment, type ScrubbedEnvironment } from "./environment.js";
import {
  collectBoundedStream,
  formatRequestLine,
  parseResponseFrame,
  redactStderr,
} from "./framing.js";

export const DEFAULT_ADAPTER_TIMEOUT_MS = 30_000;

export interface ExternalTaskSourceOptions {
  command: readonly [string, ...string[]];
  timeoutMs: number;
  maxOutputBytes: number;
  environment?: Readonly<Record<string, string>>;
  credentialVariables?: Readonly<Record<string, string>>;
  projectedFiles?: Readonly<Record<string, string>>;
  repositoryRoot?: string;
}

export class ExternalTaskSource implements TaskSource {
  private readonly command: readonly [string, ...string[]];
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly environment: Readonly<Record<string, string>>;
  private readonly credentialVariables: Readonly<Record<string, string>>;
  private readonly projectedFiles: Readonly<Record<string, string>>;
  private readonly repositoryRoot: string;
  private scrubbedEnvironment: ScrubbedEnvironment | undefined;

  constructor(options: ExternalTaskSourceOptions) {
    this.command = options.command;
    this.timeoutMs = options.timeoutMs;
    this.maxOutputBytes = options.maxOutputBytes;
    this.environment = options.environment ?? {};
    this.credentialVariables = options.credentialVariables ?? {};
    this.projectedFiles = options.projectedFiles ?? {};
    this.repositoryRoot = options.repositoryRoot ?? process.cwd();
  }

  async execute(request: TaskSourceRequest): Promise<TaskSourceResponse> {
    const parsed = parseTaskSourceRequest(request);
    assertMutationIdentity(parsed);
    const scrubbed = await this.ensureScrubbedEnvironment();
    return this.invokeAdapter(parsed, scrubbed);
  }

  private async ensureScrubbedEnvironment(): Promise<ScrubbedEnvironment> {
    if (!this.scrubbedEnvironment) {
      this.scrubbedEnvironment = await createScrubbedEnvironment({
        explicitVariables: this.environment,
        credentialVariables: this.credentialVariables,
        projectedFiles: this.projectedFiles,
      });
    }
    return this.scrubbedEnvironment;
  }

  private async invokeAdapter(
    request: TaskSourceRequest,
    scrubbed: ScrubbedEnvironment,
  ): Promise<TaskSourceResponse> {
    let child: ChildProcessWithoutNullStreams | undefined;
    let timedOut = false;
    let terminationTimer: NodeJS.Timeout | undefined;

    const terminateChild = () => {
      child?.kill("SIGTERM");
      terminationTimer = setTimeout(() => child?.kill("SIGKILL"), 100);
    };

    try {
      child = spawn(this.command[0], this.command.slice(1), {
        shell: false,
        cwd: this.repositoryRoot,
        env: scrubbed.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const stdoutPromise = collectBoundedStream(child.stdout, this.maxOutputBytes, "stdout");
      const stderrPromise = collectBoundedStream(child.stderr, this.maxOutputBytes, "stderr");
      stdoutPromise.catch(terminateChild);
      stderrPromise.catch(terminateChild);

      child.stdin.write(formatRequestLine(request));
      child.stdin.end();

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminateChild();
      }, this.timeoutMs);

      const [exitCode, stdout, stderr] = await new Promise<
        [number | null, Buffer, Buffer]
      >((resolve, reject) => {
        child!.once("error", reject);
        child!.once("close", (code) => {
          Promise.all([stdoutPromise, stderrPromise])
            .then(([stdoutBuffer, stderrBuffer]) => resolve([code, stdoutBuffer, stderrBuffer]))
            .catch(reject);
        });
      }).finally(() => {
        clearTimeout(timeoutTimer);
        if (terminationTimer) clearTimeout(terminationTimer);
      });

      const diagnosticStderr = redactStderr(stderr);

      if (timedOut) {
        throw new QuirksError("PROTOCOL_VIOLATION", "Adapter timed out", { stderr: diagnosticStderr });
      }

      if (exitCode !== 0) {
        throw new QuirksError("PROTOCOL_VIOLATION", `Adapter exited with code ${exitCode ?? "null"}`, {
          stderr: diagnosticStderr,
          exitCode: String(exitCode ?? "null"),
        });
      }

      const frame = parseResponseFrame(stdout, this.maxOutputBytes);
      return parseTaskSourceResponse(frame, request.operation);
    } catch (error) {
      if (error instanceof QuirksError) throw error;
      throw new QuirksError(
        "PROTOCOL_VIOLATION",
        error instanceof Error ? error.message : "Adapter invocation failed",
      );
    }
  }
}
