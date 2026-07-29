// The /v1 route surface — every CLI verb has a route equivalent (QK-SRV-001),
// reproduced from the bun-era src/service/app.ts (QK-MONO-003).
//
// The three routes QK-MONO-003 registered as 501 — POST /v1/runs/:id/execute,
// POST /v1/runs/:id/resume, and GET /v1/harness — answer for real as of
// QK-MONO-005.

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import type { ChildProcessSpawner } from "effect/unstable/process";
import type { GoalCreateBody, TaskProposeBody } from "@quirks/contracts";
import { Ledger } from "../store/Store.ts";
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
import { ALL_RUNNERS } from "../runner/Types.ts";
import { RUN_MODES } from "../store/Store.ts";
import { availability, harnessView } from "../ops/Harness.ts";
import { executeRun, runForExecute, runForResume } from "../run/Parent.ts";
import { defaultParentHooks } from "../run/Hooks.ts";
import type { ParentHooks } from "../run/Parent.ts";
import { bool, int, oneOf, str, strList, strListOr, body, type Body } from "./Body.ts";
import { intParam, json, page, pathParam, queryOne, respond } from "./Wire.ts";

const query = HttpServerRequest.ParsedSearchParams;

// The closed sets a body may name — IMPORTED, never re-spelled. A fourth copy
// of the runner list would mean a runner added to runner/Types.ts is silently
// refused here and quietly falls back to "claude", recording the run under the
// wrong runner: exactly the bug `implementerRunner` exists to fix.


/**
 * Each POST decodes its body AS its contract type (@quirks/contracts), so the
 * shape the server accepts and the shape the wire promises are one declaration.
 * The readers themselves live in ./Body.ts and actually check — the pair they
 * replace included a bare `as T` cast, which is how `ifRevision: "seven"` used
 * to reach the ops layer typed `number`.
 */
// `satisfies`, not an annotation: the contract is enforced without widening the
// result, so the ops layer still sees the exact optionality it expects and a
// field that drifts from the wire type is a compile error here.
/** An optional wire field is ABSENT or set — never explicitly `undefined`
 *  (`exactOptionalPropertyTypes`), which is also the truth about JSON. */
const optional = <K extends string, V>(key: K, value: V | undefined): Record<K, V> | object =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

const decodeGoalCreate = (input: Body) =>
  ({
    id: str(input, "id") ?? "",
    title: str(input, "title") ?? "",
    ...optional("why", str(input, "why")),
    ...optional("whyRef", str(input, "whyRef")),
    doneWhen: strListOr(input, "doneWhen"),
  }) satisfies GoalCreateBody;

const decodeTaskPropose = (input: Body) =>
  ({
    title: str(input, "title") ?? "",
    ...optional("goal", str(input, "goal")),
    dependsOn: strListOr(input, "dependsOn"),
    deliverables: strListOr(input, "deliverables"),
    criteria: strListOr(input, "criteria"),
    verify: strListOr(input, "verify"),
    sources: strListOr(input, "sources"),
    ...optional("effort", str(input, "effort")),
    ...optional("risk", str(input, "risk")),
    needsDesign: bool(input, "needsDesign") ?? false,
    needsBreakdown: bool(input, "needsBreakdown") ?? false,
    future: bool(input, "future") ?? false,
  }) satisfies TaskProposeBody;

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
        return json(yield* createGoal(decodeGoalCreate(yield* body)), 201);
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
        return json(yield* proposeTask(decodeTaskPropose(yield* body)), 201);
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
            ifRevision: int(input, "ifRevision"),
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
            ifRevision: int(input, "ifRevision"),
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
            ifRevision: int(input, "ifRevision"),
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
        return json(yield* releaseTask(id, { ifRevision: int(input, "ifRevision") }));
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
    const timeoutMs = int(input, "timeoutMs");
    return yield* defaultParentHooks({
      // What is actually installed, so reviewer independence is resolved against
      // the machine rather than assuming claude-only (QK-HARN-002).
      available: (yield* availability()).routable,
      // A model override carries its RUNNER. Without this both roles were
      // hard-coded to claude, so a codex model posted here dispatched, recorded
      // and reported as claude — and `quirks harness` reads those records to
      // answer "has codex ever actually run?". Absent still means claude, but
      // as a stated default rather than an inference nobody drew.
      ...(implementerModel
        ? {
            implementer: {
              runner: oneOf(input, "implementerRunner", ALL_RUNNERS) ?? "claude",
              model: implementerModel,
            },
          }
        : {}),
      ...(reviewerModel
        ? {
            reviewer: {
              runner: oneOf(input, "reviewerRunner", ALL_RUNNERS) ?? "claude",
              model: reviewerModel,
            },
          }
        : {}),
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
        // `oneOf`, not a cast: `mode: "banana"` used to reach the ops layer
        // typed RunMode, and taskIds was `unknown[] as string[]`.
        const mode = oneOf(input, "mode", RUN_MODES);
        const taskIds = strList(input, "taskIds");
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
        // `oneOf`, not a cast: `mode: "banana"` used to reach the ops layer
        // typed RunMode, and taskIds was `unknown[] as string[]`.
        const mode = oneOf(input, "mode", RUN_MODES);
        const taskIds = strList(input, "taskIds");
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


export const routes = Layer.mergeAll(goalRoutes, taskRoutes, runRoutes);
