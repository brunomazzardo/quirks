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
import { availability, harnessView } from "../ops/harness.ts";
import { executeRun, resumeRun } from "../run/parent.ts";
import { defaultParentHooks } from "../run/hooks.ts";
import type { RunMode } from "../store/types.ts";
import {
  contentFilePath,
  endShapeSession,
  ensureShapeSession,
  fontPath,
  hubFor,
  notifyScreenChange,
  pushScreen,
  readEvents,
  recordEvent,
  renderShapePage,
  startContentWatch,
  stopContentWatch,
} from "../shape/session.ts";
import { readFileSync } from "node:fs";

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

  // ---- harness ----
  // Presence and the tier table are free; `?probe=true` additionally runs
  // `--version` against each present harness. Liveness always comes from the run
  // record, so the default answer costs no round trip (QK-HARN-001).
  app.get("/v1/harness", async (c) => {
    const probe = c.req.query("probe") === "true";
    const raw = c.req.query("timeoutMs");
    const timeoutMs = raw === undefined ? undefined : Number.parseInt(raw, 10);
    return c.json(
      await harnessView(store, {
        probe,
        ...(timeoutMs !== undefined && Number.isInteger(timeoutMs) && timeoutMs > 0
          ? { timeoutMs }
          : {}),
      }),
    );
  });

  /** execute and resume take the same body and the same hooks. */
  const hooksFromRequest = async (c: { req: { json: () => Promise<unknown> } }) => {
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as {
      implementerModel?: string;
      reviewerModel?: string;
      review?: boolean;
      timeoutMs?: number;
    };
    return defaultParentHooks({
      // What is actually installed, so reviewer independence is resolved against
      // the machine rather than assuming claude-only (QK-HARN-002).
      available: availability(store).routable,
      ...(body.implementerModel
        ? { implementer: { runner: "claude" as const, model: body.implementerModel } }
        : {}),
      ...(body.reviewerModel
        ? { reviewer: { runner: "claude" as const, model: body.reviewerModel } }
        : {}),
      ...(body.review !== undefined ? { review: body.review } : {}),
      ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}),
    });
  };

  app.post("/v1/runs/:id/execute", async (c) => {
    const result = await executeRun(store, c.req.param("id"), await hooksFromRequest(c));
    return c.json(result.run);
  });

  app.post("/v1/runs/:id/resume", async (c) => {
    const result = await resumeRun(store, c.req.param("id"), await hooksFromRequest(c));
    return c.json(result.run);
  });

  // ---- shape companion (QK-COMP-003) — open on loopback; auth is QK-SRV-003 ----
  app.post("/v1/shape/ensure", (c) => {
    const host = c.req.header("host") ?? "127.0.0.1";
    const url = `http://${host}/shape/`;
    const paths = ensureShapeSession(store.root, url);
    startContentWatch(store.root);
    return c.json({
      url,
      screen_dir: paths.contentDir,
      state_dir: paths.stateDir,
      session_dir: paths.sessionDir,
    });
  });

  app.post("/v1/shape/end", (c) => {
    stopContentWatch(store.root);
    endShapeSession(store.root);
    return c.json({ status: "ended" });
  });

  app.get("/v1/shape/events", (c) => c.json({ events: readEvents(store.root) }));

  app.post("/v1/shape/screens", async (c) => {
    const body = (await c.req.json()) as { name?: string; html?: string };
    if (!body.name || typeof body.html !== "string") {
      return c.json({ error: "name and html are required" }, 400);
    }
    ensureShapeSession(
      store.root,
      `http://${c.req.header("host") ?? "127.0.0.1"}/shape/`,
    );
    startContentWatch(store.root);
    const result = pushScreen(store.root, body.name, body.html);
    notifyScreenChange(store.root);
    return c.json(result, 201);
  });

  app.get("/shape/", (c) =>
    c.html(renderShapePage(store.root), 200, {
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    }),
  );

  app.get("/shape/events-stream", (c) => {
    const hub = hubFor(store.root);
    const stream = hub.subscribe();
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      },
    });
  });

  app.post("/shape/event", async (c) => {
    const text = await c.req.text();
    if (text.length > 64 * 1024) return c.body(null, 413);
    let event: unknown;
    try {
      event = JSON.parse(text);
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    if (event && typeof event === "object" && "choice" in event && (event as { choice: unknown }).choice) {
      recordEvent(store.root, event);
    }
    return c.body(null, 204);
  });

  app.get("/shape/fonts/:name", (c) => {
    const fp = fontPath(c.req.param("name"));
    if (!fp) return c.text("Not found", 404);
    return new Response(readFileSync(fp), {
      headers: {
        "Content-Type": "font/woff2",
        "Cache-Control": "private, max-age=86400",
      },
    });
  });

  app.get("/shape/files/:name", (c) => {
    const fp = contentFilePath(store.root, c.req.param("name"));
    if (!fp) return c.text("Not found", 404);
    const ext = fp.toLowerCase().endsWith(".html")
      ? "text/html; charset=utf-8"
      : "application/octet-stream";
    return new Response(readFileSync(fp), {
      headers: { "Content-Type": ext, "Cache-Control": "no-store" },
    });
  });

  return app;
}
