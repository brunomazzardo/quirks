// quirks run — the only thing approved. Plan prints first; --yes (or a TTY
// [y/N]) persists an approved run. Dispatch is QK-RUN-003; this verb stops at
// the durable approval. Nothing on the execution path prompts: without --yes
// and without a TTY, we refuse rather than hang.

import { createInterface } from "node:readline";
import { request } from "./client.ts";
import { CliError, emitJson, table } from "./output.ts";

interface PlanEntry {
  id: string;
  title: string;
  order: number;
  harness: string;
  model: string;
  estimatedCost: number | null;
}

interface RunPlan {
  name: string;
  slug: string;
  goal?: string;
  mode: string;
  plan: PlanEntry[];
  taskIds: string[];
}

function renderPlan(plan: RunPlan): string {
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
  return `${header}\n${body}`;
}

async function confirmYesNo(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question("Approve this run? [y/N] ", resolve);
    });
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function runStart(
  taskIds: string[],
  opts: {
    name?: string;
    goal?: string;
    mode?: string;
    yes: boolean;
    dryRun: boolean;
    json: boolean;
  },
): Promise<void> {
  if (!opts.name) throw new CliError("--name is required");

  const body = {
    name: opts.name,
    goal: opts.goal,
    mode: opts.mode,
    taskIds: taskIds.length > 0 ? taskIds : undefined,
  };

  const plan: RunPlan = await request("POST", "/v1/runs/plan", body);

  if (opts.dryRun) {
    const result = await request("POST", "/v1/runs", { ...body, dryRun: true });
    if (opts.json || !process.stdout.isTTY) emitJson(result);
    else {
      console.log(renderPlan(plan));
      console.log("\n--- briefs (dry-run, not dispatched) ---\n");
      emitJson(result.briefs);
    }
    return;
  }

  // Show the plan before approval — the whole approval surface.
  if (opts.json || !process.stdout.isTTY) {
    // Headless consumers see the plan embedded in the eventual run object;
    // still refuse to persist without --yes (never prompt on a pipe).
    if (!opts.yes) {
      emitJson(plan);
      throw new CliError(
        "refusing to start a run without --yes — nothing on the execution path may prompt",
      );
    }
  } else {
    console.log(renderPlan(plan));
    if (!opts.yes) {
      const ok = await confirmYesNo();
      if (!ok) {
        console.error("quirks: run not started");
        process.exit(1);
      }
    }
  }

  const result = await request("POST", "/v1/runs", { ...body, yes: true });
  emitJson(result.run ?? result);
}

export async function runList(opts: { json: boolean }): Promise<void> {
  const runs = (await request("GET", "/v1/runs?limit=1000")).items as Array<{
    id: string;
    slug: string;
    status: string;
    mode: string;
    name: string;
    taskIds: string[];
  }>;
  if (opts.json || !process.stdout.isTTY) emitJson(runs);
  else if (runs.length === 0) console.log("no runs");
  else {
    console.log(
      table(
        ["run", "slug", "status", "mode", "tasks", "name"],
        runs.map((r) => [r.id, r.slug, r.status, r.mode, String(r.taskIds.length), r.name]),
      ),
    );
  }
}

export async function runShow(idOrSlug: string): Promise<void> {
  emitJson(await request("GET", `/v1/runs/${encodeURIComponent(idOrSlug)}`));
}
