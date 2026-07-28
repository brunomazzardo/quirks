// quirks run — the only thing approved. The plan prints first; --yes (or a TTY
// [y/N]) persists an approved run, and the approved run then executes.
//
// Nothing on the execution path prompts: without --yes and without a TTY we
// refuse rather than hang. The [y/N] is the one prompt in the whole CLI, and it
// stands *before* execution, never inside it.

import { createInterface } from "node:readline";
import * as Effect from "effect/Effect";
import type { Run, RunPlan } from "@quirks/contracts";
import { request, type ServiceError } from "./Client.ts";
import { cliError, emitJson, emitText, isTty, table, type CliError } from "./Output.ts";

export function renderPlan(plan: RunPlan): string {
  const header = [
    `run: ${plan.name} (${plan.slug})`,
    `mode: ${plan.mode}`,
    plan.goal ? `goal: ${plan.goal}` : null,
    `${plan.plan.length} task(s)`,
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");
  const body = table(
    ["#", "task", "harness", "model", "est.", "title"],
    plan.plan.map((p) => [
      String(p.order),
      p.id,
      p.harness,
      p.model,
      p.estimatedCost === null ? "?" : String(p.estimatedCost),
      p.title,
    ]),
  );
  // Warnings go last, immediately above the [y/N] — this is the whole approval
  // surface, so what is doubtful about the plan must be the last thing read.
  const warnings = plan.warnings ?? [];
  const caveats =
    warnings.length === 0
      ? ""
      : `\n\nbefore you approve:\n${warnings.map((w) => `  ! ${w}`).join("\n")}`;
  return `${header}\n${body}${caveats}`;
}

export function renderRuns(runs: readonly Run[]): string {
  return runs.length === 0
    ? "no runs"
    : table(
        ["run", "slug", "status", "mode", "tasks", "name"],
        runs.map((r) => [r.id, r.slug, r.status, r.mode, String(r.taskIds.length), r.name]),
      );
}

/**
 * The question goes to stderr so a redirected stdout still carries only data.
 *
 * The gate above is `stdout.isTTY`, which says a human is reading — it does not
 * promise anyone is typing. When stdin ends without an answer (a terminal whose
 * input is a closed pipe), the close event resolves this as a plain "no": the
 * one thing a prompt on the approval path may never do is wait forever.
 */
const confirmYesNo: Effect.Effect<boolean> = Effect.promise(async () => {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.on("close", () => resolve(""));
      rl.question("Approve this run? [y/N] ", resolve);
    });
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
});

export interface RunStartOptions {
  name?: string;
  goal?: string;
  mode?: string;
  yes: boolean;
  dryRun: boolean;
  approveOnly: boolean;
  resume?: string;
  json: boolean;
}

export const runStart = (
  taskIds: string[],
  opts: RunStartOptions,
): Effect.Effect<void, ServiceError | CliError> =>
  Effect.gen(function* () {
    if (opts.resume) {
      // No plan, no approval — pick up an interrupted run by id or slug.
      yield* emitJson(
        yield* request("POST", `/v1/runs/${encodeURIComponent(opts.resume)}/resume`, {}),
      );
      return;
    }

    if (!opts.name) return yield* Effect.fail(cliError("--name is required"));

    const body = {
      name: opts.name,
      goal: opts.goal,
      mode: opts.mode,
      taskIds: taskIds.length > 0 ? taskIds : undefined,
    };

    const plan: RunPlan = yield* request("POST", "/v1/runs/plan", body);
    const piped = opts.json || !isTty();

    if (opts.dryRun) {
      const result = yield* request("POST", "/v1/runs", { ...body, dryRun: true });
      if (piped) {
        yield* emitJson(result);
      } else {
        yield* emitText(renderPlan(plan));
        yield* emitText("\n--- briefs (dry-run, not dispatched) ---\n");
        yield* emitJson(result.briefs);
      }
      return;
    }

    // Show the plan before approval — the whole approval surface.
    if (piped) {
      if (!opts.yes) {
        yield* emitJson(plan);
        return yield* Effect.fail(
          cliError(
            "refusing to start a run without --yes — nothing on the execution path may prompt",
          ),
        );
      }
    } else {
      yield* emitText(renderPlan(plan));
      if (!opts.yes && !(yield* confirmYesNo)) {
        return yield* Effect.sync(() => {
          console.error("quirks: run not started");
          process.exit(1);
        });
      }
    }

    const result = yield* request("POST", "/v1/runs", { ...body, yes: true });
    const run = result.run ?? result;
    if (opts.approveOnly) {
      yield* emitJson(run);
      return;
    }
    yield* emitJson(yield* request("POST", `/v1/runs/${encodeURIComponent(run.id)}/execute`, {}));
  });

export const runList = (opts: { json: boolean }): Effect.Effect<void, ServiceError> =>
  Effect.gen(function* () {
    const runs = (yield* request("GET", "/v1/runs?limit=1000")).items as Run[];
    if (opts.json || !isTty()) yield* emitJson(runs);
    else yield* emitText(renderRuns(runs));
  });

export const runShow = (idOrSlug: string): Effect.Effect<void, ServiceError> =>
  Effect.gen(function* () {
    yield* emitJson(yield* request("GET", `/v1/runs/${encodeURIComponent(idOrSlug)}`));
  });
