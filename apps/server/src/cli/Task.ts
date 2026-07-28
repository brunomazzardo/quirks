// The task verbs: flag parsing and rendering only — every byte of data goes
// through the HTTP client. No store import may ever appear in this file.

import * as Effect from "effect/Effect";
import type { Task } from "@quirks/contracts";
import { request, serviceError, type ServiceError } from "./Client.ts";
import { emitJson, emitRead, table } from "./Output.ts";

/** What `quirks task list` shows of a task. The wire sends the whole `Task`;
 *  the table reads only these, and the extra columns are what `task show` is
 *  for. */
type TaskRow = Pick<Task, "id" | "status" | "title" | "needsDesign" | "needsBreakdown"> & {
  future?: boolean | undefined;
};

const parseIfRevision = (
  value: string | undefined,
): Effect.Effect<number | undefined, ServiceError> =>
  Effect.suspend(() => {
    if (value === undefined) return Effect.succeed(undefined);
    const n = Number.parseInt(value, 10);
    return Number.isNaN(n)
      ? Effect.fail(serviceError(`--if-revision wants a number, got ${JSON.stringify(value)}`))
      : Effect.succeed(n);
  });

function flagMarks(t: TaskRow): string {
  return [
    t.needsDesign ? "design?" : "",
    t.needsBreakdown ? "breakdown?" : "",
    t.future ? "future" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function renderTasks(tasks: readonly TaskRow[]): string {
  return tasks.length === 0
    ? "no tasks"
    : table(
        ["task", "status", "flags", "title"],
        tasks.map((t) => [t.id, t.status, flagMarks(t), t.title]),
      );
}

export const taskPropose = (opts: {
  title: string;
  goal?: string;
  dependsOn: string[];
  deliverable: string[];
  criterion: string[];
  verify: string[];
  source: string[];
  effort?: string;
  risk?: string;
  needsDesign: boolean;
  needsBreakdown: boolean;
  future: boolean;
}): Effect.Effect<void, ServiceError> =>
  Effect.gen(function* () {
    yield* emitJson(
      yield* request("POST", "/v1/tasks", {
        title: opts.title,
        goal: opts.goal,
        dependsOn: opts.dependsOn,
        deliverables: opts.deliverable,
        criteria: opts.criterion,
        verify: opts.verify,
        sources: opts.source,
        effort: opts.effort,
        risk: opts.risk,
        needsDesign: opts.needsDesign,
        needsBreakdown: opts.needsBreakdown,
        future: opts.future,
      }),
    );
  });

export const taskList = (opts: {
  json: boolean;
  goal?: string;
  status?: string;
}): Effect.Effect<void, ServiceError> =>
  Effect.gen(function* () {
    const params = new URLSearchParams({ limit: "1000" });
    if (opts.goal !== undefined) params.set("goal", opts.goal);
    if (opts.status !== undefined) params.set("status", opts.status);
    const tasks: TaskRow[] = (yield* request("GET", `/v1/tasks?${params}`)).items;
    yield* emitRead(tasks, opts.json, () => renderTasks(tasks));
  });

export const taskShow = (id: string): Effect.Effect<void, ServiceError> =>
  Effect.gen(function* () {
    // The detail view is the JSON either way — every field matters and a table
    // hides some.
    yield* emitJson(yield* request("GET", `/v1/tasks/${encodeURIComponent(id)}`));
  });

export const taskClaim = (
  id: string,
  opts: { by?: string; force: boolean; ifRevision?: string },
): Effect.Effect<void, ServiceError> =>
  Effect.gen(function* () {
    yield* emitJson(
      yield* request("POST", `/v1/tasks/${encodeURIComponent(id)}/claim`, {
        by: opts.by,
        force: opts.force,
        ifRevision: yield* parseIfRevision(opts.ifRevision),
      }),
    );
  });

export const taskBlock = (
  id: string,
  opts: { reason?: string; until?: string; ifRevision?: string },
): Effect.Effect<void, ServiceError> =>
  Effect.gen(function* () {
    yield* emitJson(
      yield* request("POST", `/v1/tasks/${encodeURIComponent(id)}/block`, {
        reason: opts.reason,
        until: opts.until,
        ifRevision: yield* parseIfRevision(opts.ifRevision),
      }),
    );
  });

export const taskComplete = (
  id: string,
  opts: { evidence?: string; ifRevision?: string },
): Effect.Effect<void, ServiceError> =>
  Effect.gen(function* () {
    yield* emitJson(
      yield* request("POST", `/v1/tasks/${encodeURIComponent(id)}/complete`, {
        evidence: opts.evidence,
        ifRevision: yield* parseIfRevision(opts.ifRevision),
      }),
    );
  });

export const taskRelease = (
  id: string,
  opts: { ifRevision?: string },
): Effect.Effect<void, ServiceError> =>
  Effect.gen(function* () {
    yield* emitJson(
      yield* request("POST", `/v1/tasks/${encodeURIComponent(id)}/release`, {
        ifRevision: yield* parseIfRevision(opts.ifRevision),
      }),
    );
  });
