import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { performance } from "node:perf_hooks";
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

const MONOTONIC_TIMEOUT_POLL_MS = 50;

export interface ExternalTaskSourceOptions {
  command: readonly [string, ...string[]];
  timeoutMs: number;
  maxOutputBytes: number;
  environment?: Readonly<Record<string, string>>;
  credentialVariables?: Readonly<Record<string, string>>;
  projectedFiles?: Readonly<Record<string, string>>;
  repositoryRoot?: string;
}

function createMonotonicTimeout(
  timeoutMs: number,
  onTimeout: () => void,
): { cancel: () => void; hasTimedOut: () => boolean } {
  const startedAt = performance.now();
  let fired = false;
  let timer: NodeJS.Timeout | undefined;

  const schedule = (): void => {
    const remaining = timeoutMs - (performance.now() - startedAt);
    if (remaining <= 0) {
      if (!fired) {
        fired = true;
        onTimeout();
      }
      return;
    }
    timer = setTimeout(schedule, Math.min(remaining, MONOTONIC_TIMEOUT_POLL_MS));
  };

  schedule();

  return {
    cancel: () => {
      if (timer) clearTimeout(timer);
    },
    hasTimedOut: () => fired,
  };
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

  async dispose(): Promise<void> {
    if (this.scrubbedEnvironment) {
      await this.scrubbedEnvironment.cleanup();
      this.scrubbedEnvironment = undefined;
    }
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

      const timeout = createMonotonicTimeout(this.timeoutMs, terminateChild);

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
        timeout.cancel();
        if (terminationTimer) clearTimeout(terminationTimer);
      });

      const diagnosticStderr = redactStderr(stderr);

      if (timeout.hasTimedOut()) {
        throw new QuirksError(
          "SOURCE_UNAVAILABLE",
          `Adapter timed out after ${this.timeoutMs}ms`,
          { stderr: diagnosticStderr, timeoutMs: String(this.timeoutMs) },
        );
      }

      let frame: unknown;
      try {
        frame = parseResponseFrame(stdout, this.maxOutputBytes);
      } catch (error) {
        if (exitCode !== 0) {
          throw new QuirksError(
            "SOURCE_UNAVAILABLE",
            `Adapter exited with code ${exitCode ?? "null"} without a valid response frame`,
            { stderr: diagnosticStderr, exitCode: String(exitCode ?? "null") },
          );
        }
        throw error;
      }

      return parseTaskSourceResponse(frame, request.operation);
    } catch (error) {
      if (error instanceof QuirksError) throw error;
      throw new QuirksError(
        "SOURCE_UNAVAILABLE",
        error instanceof Error ? error.message : "Adapter invocation failed",
      );
    }
  }
}
