// The service routes — every CLI verb has a route equivalent (QK-SRV-001).
// One authority: these routes and the CLI both call src/ops; at QK-SRV-004 the
// CLI stops calling ops directly and becomes a client of this surface.

import { Hono } from "hono";
import type { Store } from "../store/store.ts";
import { StoreCorruptError } from "../store/json-file.ts";
import { TransitionError } from "../store/transitions.ts";
import { ConflictError, NotFoundError, ValidationError } from "../ops/errors.ts";
import { createGoal, getGoal, leaveActive, rollup } from "../ops/goals.ts";
import {
  blockTask,
  claimTask,
  completeTask,
  getTask,
  listTasks,
  proposeTask,
  releaseTask,
} from "../ops/tasks.ts";
import { assemblePlan, getRun, listRuns, startRun } from "../ops/runs.ts";
import { executeRun } from "../run/parent.ts";
import { defaultParentHooks } from "../run/hooks.ts";
import type { RunMode } from "../store/types.ts";

/** Paginate a list route: ?offset=&limit= (native-app budgets force it — the
 *  real v1 ledger sat at 82% of the 256 KiB fetch ceiling). */
function page<T>(items: T[], offset: number, limit: number) {
  return {
    total: items.length,
    offset,
    limit,
    items: items.slice(offset, offset + limit),
  };
}

function intParam(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function createApp(store: Store): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ConflictError || err instanceof TransitionError) {
      return c.json({ error: err.message }, 409);
    }
    if (err instanceof StoreCorruptError) return c.json({ error: err.message }, 500);
    throw err;
  });

  // ---- goals ----
  app.get("/v1/goals", (c) => {
    const rows = rollup(store);
    const all = c.req.query("all") === "true";
    const shown = all ? rows : rows.filter((r) => r.state !== "done" && r.state !== "abandoned");
    return c.json(page(shown, intParam(c.req.query("offset"), 0), intParam(c.req.query("limit"), 100)));
  });

  app.post("/v1/goals", async (c) => {
    const body = await c.req.json();
    return c.json(
      createGoal(store, {
        id: body.id,
        title: body.title,
        why: body.why,
        whyRef: body.whyRef,
        doneWhen: body.doneWhen ?? [],
      }),
      201,
    );
  });

  app.get("/v1/goals/:id", (c) => c.json(getGoal(store, c.req.param("id"))));

  app.post("/v1/goals/:id/done", async (c) => {
    const body = await c.req.json();
    return c.json(leaveActive(store, c.req.param("id"), body.reason, "done"));
  });

  app.post("/v1/goals/:id/abandon", async (c) => {
    const body = await c.req.json();
    return c.json(leaveActive(store, c.req.param("id"), body.reason, "abandoned"));
  });

  // ---- tasks ----
  app.get("/v1/tasks", (c) => {
    const filter: { goal?: string; status?: string } = {};
    const goal = c.req.query("goal");
    const status = c.req.query("status");
    if (goal !== undefined) filter.goal = goal;
    if (status !== undefined) filter.status = status;
    const tasks = listTasks(store, filter);
    return c.json(page(tasks, intParam(c.req.query("offset"), 0), intParam(c.req.query("limit"), 100)));
  });

  app.post("/v1/tasks", async (c) => {
    const body = await c.req.json();
    return c.json(
      proposeTask(store, {
        title: body.title,
        goal: body.goal,
        dependsOn: body.dependsOn ?? [],
        deliverables: body.deliverables ?? [],
        criteria: body.criteria ?? [],
        verify: body.verify ?? [],
        sources: body.sources ?? [],
        effort: body.effort,
        risk: body.risk,
        needsDesign: body.needsDesign ?? false,
        needsBreakdown: body.needsBreakdown ?? false,
        future: body.future ?? false,
      }),
      201,
    );
  });

  app.get("/v1/tasks/:id", (c) => c.json(getTask(store, c.req.param("id"))));

  app.post("/v1/tasks/:id/claim", async (c) => {
    const body = await c.req.json();
    return c.json(claimTask(store, c.req.param("id"), body));
  });

  app.post("/v1/tasks/:id/block", async (c) => {
    const body = await c.req.json();
    return c.json(blockTask(store, c.req.param("id"), body));
  });

  app.post("/v1/tasks/:id/complete", async (c) => {
    const body = await c.req.json();
    return c.json(completeTask(store, c.req.param("id"), body));
  });

  app.post("/v1/tasks/:id/release", async (c) => {
    const body = await c.req.json();
    return c.json(releaseTask(store, c.req.param("id"), body));
  });

  // ---- runs ----
  app.get("/v1/runs", (c) => {
    const runs = listRuns(store);
    return c.json(page(runs, intParam(c.req.query("offset"), 0), intParam(c.req.query("limit"), 100)));
  });

  app.post("/v1/runs/plan", async (c) => {
    const body = await c.req.json();
    return c.json(
      assemblePlan(store, {
        name: body.name,
        ...(body.goal !== undefined ? { goal: body.goal } : {}),
        ...(body.mode !== undefined ? { mode: body.mode as RunMode } : {}),
        ...(body.taskIds !== undefined ? { taskIds: body.taskIds } : {}),
      }),
    );
  });

  app.post("/v1/runs", async (c) => {
    const body = await c.req.json();
    const result = startRun(store, {
      name: body.name,
      ...(body.goal !== undefined ? { goal: body.goal } : {}),
      ...(body.mode !== undefined ? { mode: body.mode as RunMode } : {}),
      ...(body.taskIds !== undefined ? { taskIds: body.taskIds } : {}),
      dryRun: body.dryRun === true,
      yes: body.yes === true,
    });
    return c.json(result, result.dryRun ? 200 : 201);
  });

  app.get("/v1/runs/:id", (c) => c.json(getRun(store, c.req.param("id"))));

  app.post("/v1/runs/:id/execute", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      implementerModel?: string;
      reviewerModel?: string;
      review?: boolean;
      timeoutMs?: number;
    };
    const hooks = defaultParentHooks({
      ...(body.implementerModel
        ? { implementer: { runner: "claude" as const, model: body.implementerModel } }
        : {}),
      ...(body.reviewerModel
        ? { reviewer: { runner: "claude" as const, model: body.reviewerModel } }
        : {}),
      ...(body.review !== undefined ? { review: body.review } : {}),
      ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}),
    });
    const result = await executeRun(store, c.req.param("id"), hooks);
    return c.json(result.run);
  });

  return app;
}
