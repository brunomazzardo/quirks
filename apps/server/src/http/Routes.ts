// The /v1 route surface — every CLI verb has a route equivalent (QK-SRV-001),
// reproduced from the bun-era src/service/app.ts (QK-MONO-003).
//
// The three routes QK-MONO-003 registered as 501 — POST /v1/runs/:id/execute,
// POST /v1/runs/:id/resume, and GET /v1/harness — answer for real as of
// QK-MONO-005.

import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { ChildProcessSpawner } from "effect/unstable/process";
import type { RunMode } from "@quirks/contracts";
import { Ledger, Store } from "../store/Store.ts";
import type { StoreError } from "../store/JsonFile.ts";
import type { ValidationError } from "../ops/Errors.ts";
import { createGoal, getGoal, leaveActive, rollup } from "../ops/Goals.ts";
import {
  blockTask,
  claimTask,
  completeTask,
  getTask,
  listTasks,
  proposeTask,
  releaseTask,
} from "../ops/Tasks.ts";
import { assemblePlan, getRun, listRuns, startRun } from "../ops/Runs.ts";
import { availability, harnessView } from "../ops/Harness.ts";
import { executeRun, runForExecute, runForResume } from "../run/Parent.ts";
import { defaultParentHooks } from "../run/Hooks.ts";
import type { ParentHooks } from "../run/Parent.ts";
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
} from "../shape/Session.ts";
import { intParam, json, jsonError, page, queryOne, respond } from "./Wire.ts";

/** A route path parameter. Absent is impossible for a matched route, but the
 *  router types it as optional — refuse rather than coerce. */
const pathParam = (key: string): Effect.Effect<string, never, HttpRouter.RouteContext> =>
  Effect.map(HttpRouter.params, (params) => params[key] ?? "");

const query = HttpServerRequest.ParsedSearchParams;

const body = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return (yield* request.json) as Record<string, unknown> | null;
});

/** Body fields the bun-era routes read off `await c.req.json()` untyped. */
const field = <T>(source: Record<string, unknown> | null, key: string): T | undefined =>
  (source?.[key] as T | undefined) ?? undefined;

const str = (source: Record<string, unknown> | null, key: string): string | undefined => {
  const value = source?.[key];
  return typeof value === "string" ? value : undefined;
};

const bool = (source: Record<string, unknown> | null, key: string): boolean | undefined => {
  const value = source?.[key];
  return typeof value === "boolean" ? value : undefined;
};

const list = (source: Record<string, unknown> | null, key: string): string[] => {
  const value = source?.[key];
  return Array.isArray(value) ? (value as string[]) : [];
};

// ---- goals ----

const goalRoutes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/v1/goals",
    respond(
      Effect.gen(function* () {
        const params = yield* query;
        const rows = yield* rollup;
        const all = queryOne(params, "all") === "true";
        const shown = all
          ? rows
          : rows.filter((r) => r.state !== "done" && r.state !== "abandoned");
        return json(
          page(
            shown,
            intParam(queryOne(params, "offset"), 0),
            intParam(queryOne(params, "limit"), 100),
          ),
        );
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/goals",
    respond(
      Effect.gen(function* () {
        const input = yield* body;
        return json(
          yield* createGoal({
            id: str(input, "id") ?? "",
            title: str(input, "title") ?? "",
            why: str(input, "why"),
            whyRef: str(input, "whyRef"),
            doneWhen: Array.isArray(input?.["doneWhen"]) ? list(input, "doneWhen") : [],
          }),
          201,
        );
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/v1/goals/:id",
    respond(
      Effect.gen(function* () {
        return json(yield* getGoal(yield* pathParam("id")));
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/goals/:id/done",
    respond(
      Effect.gen(function* () {
        const id = yield* pathParam("id");
        const input = yield* body;
        return json(yield* leaveActive(id, str(input, "reason"), "done"));
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/goals/:id/abandon",
    respond(
      Effect.gen(function* () {
        const id = yield* pathParam("id");
        const input = yield* body;
        return json(yield* leaveActive(id, str(input, "reason"), "abandoned"));
      }),
    ),
  ),
);

// ---- tasks ----

const taskRoutes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/v1/tasks",
    respond(
      Effect.gen(function* () {
        const params = yield* query;
        const goal = queryOne(params, "goal");
        const status = queryOne(params, "status");
        const tasks = yield* listTasks({
          ...(goal !== undefined ? { goal } : {}),
          ...(status !== undefined ? { status } : {}),
        });
        return json(
          page(
            tasks,
            intParam(queryOne(params, "offset"), 0),
            intParam(queryOne(params, "limit"), 100),
          ),
        );
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/tasks",
    respond(
      Effect.gen(function* () {
        const input = yield* body;
        return json(
          yield* proposeTask({
            title: str(input, "title") ?? "",
            goal: str(input, "goal"),
            dependsOn: list(input, "dependsOn"),
            deliverables: list(input, "deliverables"),
            criteria: list(input, "criteria"),
            verify: list(input, "verify"),
            sources: list(input, "sources"),
            effort: str(input, "effort"),
            risk: str(input, "risk"),
            needsDesign: bool(input, "needsDesign") ?? false,
            needsBreakdown: bool(input, "needsBreakdown") ?? false,
            future: bool(input, "future") ?? false,
          }),
          201,
        );
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/v1/tasks/:id",
    respond(
      Effect.gen(function* () {
        return json(yield* getTask(yield* pathParam("id")));
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/tasks/:id/claim",
    respond(
      Effect.gen(function* () {
        const id = yield* pathParam("id");
        const input = yield* body;
        return json(
          yield* claimTask(id, {
            by: str(input, "by"),
            force: bool(input, "force"),
            ifRevision: field<number>(input, "ifRevision"),
          }),
        );
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/tasks/:id/block",
    respond(
      Effect.gen(function* () {
        const id = yield* pathParam("id");
        const input = yield* body;
        return json(
          yield* blockTask(id, {
            reason: str(input, "reason"),
            until: str(input, "until"),
            ifRevision: field<number>(input, "ifRevision"),
          }),
        );
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/tasks/:id/complete",
    respond(
      Effect.gen(function* () {
        const id = yield* pathParam("id");
        const input = yield* body;
        return json(
          yield* completeTask(id, {
            evidence: str(input, "evidence"),
            ifRevision: field<number>(input, "ifRevision"),
          }),
        );
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/tasks/:id/release",
    respond(
      Effect.gen(function* () {
        const id = yield* pathParam("id");
        const input = yield* body;
        return json(yield* releaseTask(id, { ifRevision: field<number>(input, "ifRevision") }));
      }),
    ),
  ),
);

// ---- runs ----

/** execute and resume take the same body and the same hooks. */
const hooksFromBody = (
  input: Record<string, unknown> | null,
): Effect.Effect<
  ParentHooks,
  StoreError | ValidationError,
  Ledger | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const implementerModel = str(input, "implementerModel");
    const reviewerModel = str(input, "reviewerModel");
    const review = bool(input, "review");
    const timeoutMs = field<number>(input, "timeoutMs");
    return yield* defaultParentHooks({
      // What is actually installed, so reviewer independence is resolved against
      // the machine rather than assuming claude-only (QK-HARN-002).
      available: (yield* availability()).routable,
      ...(implementerModel
        ? { implementer: { runner: "claude" as const, model: implementerModel } }
        : {}),
      ...(reviewerModel ? { reviewer: { runner: "claude" as const, model: reviewerModel } } : {}),
      ...(review !== undefined ? { review } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
  });

const runRoutes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/v1/runs",
    respond(
      Effect.gen(function* () {
        const params = yield* query;
        const runs = yield* listRuns;
        return json(
          page(
            runs,
            intParam(queryOne(params, "offset"), 0),
            intParam(queryOne(params, "limit"), 100),
          ),
        );
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/runs/plan",
    respond(
      Effect.gen(function* () {
        const input = yield* body;
        const goal = str(input, "goal");
        const mode = str(input, "mode") as RunMode | undefined;
        const taskIds = input?.["taskIds"] === undefined ? undefined : list(input, "taskIds");
        return json(
          yield* assemblePlan({
            name: str(input, "name") ?? "",
            ...(goal !== undefined ? { goal } : {}),
            ...(mode !== undefined ? { mode } : {}),
            ...(taskIds !== undefined ? { taskIds } : {}),
          }),
        );
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/runs",
    respond(
      Effect.gen(function* () {
        const input = yield* body;
        const goal = str(input, "goal");
        const mode = str(input, "mode") as RunMode | undefined;
        const taskIds = input?.["taskIds"] === undefined ? undefined : list(input, "taskIds");
        const result = yield* startRun({
          name: str(input, "name") ?? "",
          ...(goal !== undefined ? { goal } : {}),
          ...(mode !== undefined ? { mode } : {}),
          ...(taskIds !== undefined ? { taskIds } : {}),
          dryRun: input?.["dryRun"] === true,
          yes: input?.["yes"] === true,
        });
        return json(result, result.dryRun ? 200 : 201);
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/v1/runs/:id",
    respond(
      Effect.gen(function* () {
        return json(yield* getRun(yield* pathParam("id")));
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/runs/:id/execute",
    respond(
      Effect.gen(function* () {
        // Resolve the run BEFORE consulting the machine for a harness: a missing
        // or finished run is 404/409 on every machine, rather than 400 "no
        // harness installed" on the ones with nothing on PATH. The bun-era route
        // built hooks first and had the opposite property.
        const run = yield* runForExecute(yield* pathParam("id"));
        const hooks = yield* hooksFromBody(yield* body);
        return json((yield* executeRun(run.id, hooks)).run);
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/runs/:id/resume",
    respond(
      Effect.gen(function* () {
        const run = yield* runForResume(yield* pathParam("id"));
        const hooks = yield* hooksFromBody(yield* body);
        return json((yield* executeRun(run.id, hooks)).run);
      }),
    ),
  ),

  // Presence and the tier table are free; `?probe=true` additionally runs
  // `--version` and the runner's own auth-status command against each present
  // harness. Liveness always comes from the run record, so the default answer
  // costs no round trip (QK-HARN-001).
  HttpRouter.add(
    "GET",
    "/v1/harness",
    respond(
      Effect.gen(function* () {
        const params = yield* query;
        const raw = queryOne(params, "timeoutMs");
        const timeoutMs = raw === undefined ? undefined : Number.parseInt(raw, 10);
        return json(
          yield* harnessView({
            probe: queryOne(params, "probe") === "true",
            ...(timeoutMs !== undefined && Number.isInteger(timeoutMs) && timeoutMs > 0
              ? { timeoutMs }
              : {}),
          }),
        );
      }),
    ),
  ),
);

// ---- shape companion (QK-COMP-003) — open on loopback; auth is QK-SRV-003 ----

const hostHeader = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return request.headers["host"] ?? "127.0.0.1";
});

const shapeRoutes = Layer.mergeAll(
  HttpRouter.add(
    "POST",
    "/v1/shape/ensure",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        const url = `http://${yield* hostHeader}/shape/`;
        const paths = ensureShapeSession(store.root, url);
        startContentWatch(store.root);
        return json({
          url,
          screen_dir: paths.contentDir,
          state_dir: paths.stateDir,
          session_dir: paths.sessionDir,
        });
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/shape/end",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        stopContentWatch(store.root);
        endShapeSession(store.root);
        return json({ status: "ended" });
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/v1/shape/events",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        return json({ events: readEvents(store.root) });
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/v1/shape/screens",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        const input = yield* body;
        const name = str(input, "name");
        const html = str(input, "html");
        if (!name || html === undefined) {
          return jsonError("name and html are required", 400);
        }
        ensureShapeSession(store.root, `http://${yield* hostHeader}/shape/`);
        startContentWatch(store.root);
        const result = pushScreen(store.root, name, html);
        notifyScreenChange(store.root);
        return json(result, 201);
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/shape/",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        return HttpServerResponse.text(renderShapePage(store.root), {
          status: 200,
          contentType: "text/html; charset=utf-8",
          headers: {
            "Cache-Control": "no-store",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
          },
        });
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/shape/events-stream",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        const hub = hubFor(store.root);
        return HttpServerResponse.stream(
          Stream.fromReadableStream<Uint8Array, unknown>({
            evaluate: () => hub.subscribe(),
            onError: (error) => error,
          }),
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-store",
              Connection: "keep-alive",
            },
          },
        );
      }),
    ),
  ),

  HttpRouter.add(
    "POST",
    "/shape/event",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const text = yield* request.text;
        if (text.length > 64 * 1024) return HttpServerResponse.empty({ status: 413 });
        let event: unknown;
        try {
          event = JSON.parse(text);
        } catch {
          return jsonError("invalid JSON", 400);
        }
        if (
          event !== null &&
          typeof event === "object" &&
          "choice" in event &&
          (event as { choice: unknown }).choice
        ) {
          recordEvent(store.root, event);
        }
        return HttpServerResponse.empty({ status: 204 });
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/shape/fonts/:name",
    respond(
      Effect.gen(function* () {
        const fp = fontPath(yield* pathParam("name"));
        if (!fp) return HttpServerResponse.text("Not found", { status: 404 });
        return HttpServerResponse.uint8Array(readFileSync(fp), {
          contentType: "font/woff2",
          headers: { "Cache-Control": "private, max-age=86400" },
        });
      }),
    ),
  ),

  HttpRouter.add(
    "GET",
    "/shape/files/:name",
    respond(
      Effect.gen(function* () {
        const store = yield* Store;
        const fp = contentFilePath(store.root, yield* pathParam("name"));
        if (!fp) return HttpServerResponse.text("Not found", { status: 404 });
        const contentType = fp.toLowerCase().endsWith(".html")
          ? "text/html; charset=utf-8"
          : "application/octet-stream";
        return HttpServerResponse.uint8Array(readFileSync(fp), {
          contentType,
          headers: { "Cache-Control": "no-store" },
        });
      }),
    ),
  ),
);

export const routes = Layer.mergeAll(goalRoutes, taskRoutes, runRoutes, shapeRoutes);
