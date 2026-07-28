// The task verbs: flag parsing and rendering only — every byte of data goes
// through the HTTP client. No store import may ever appear in this file.

import { request, ServiceError } from "./client.ts";
import { emitJson, emitRead, table } from "./output.ts";

interface TaskDto {
  id: string;
  status: string;
  title: string;
  needsDesign: boolean;
  needsBreakdown: boolean;
  future?: boolean;
}

function parseIfRevision(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new ServiceError(`--if-revision wants a number, got ${JSON.stringify(value)}`);
  return n;
}

function flagMarks(t: TaskDto): string {
  return [
    t.needsDesign ? "design?" : "",
    t.needsBreakdown ? "breakdown?" : "",
    t.future ? "future" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function taskPropose(opts: {
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
}): Promise<void> {
  emitJson(
    await request("POST", "/v1/tasks", {
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
}

export async function taskList(opts: { json: boolean; goal?: string; status?: string }): Promise<void> {
  const params = new URLSearchParams({ limit: "1000" });
  if (opts.goal !== undefined) params.set("goal", opts.goal);
  if (opts.status !== undefined) params.set("status", opts.status);
  const tasks: TaskDto[] = (await request("GET", `/v1/tasks?${params}`)).items;
  emitRead(tasks, opts.json, () =>
    tasks.length === 0
      ? "no tasks"
      : table(
          ["task", "status", "flags", "title"],
          tasks.map((t) => [t.id, t.status, flagMarks(t), t.title]),
        ),
  );
}

export async function taskShow(id: string): Promise<void> {
  // The detail view is the JSON either way — every field matters and a table hides some.
  emitJson(await request("GET", `/v1/tasks/${encodeURIComponent(id)}`));
}

export async function taskClaim(
  id: string,
  opts: { by?: string; force: boolean; ifRevision?: string },
): Promise<void> {
  emitJson(
    await request("POST", `/v1/tasks/${encodeURIComponent(id)}/claim`, {
      by: opts.by,
      force: opts.force,
      ifRevision: parseIfRevision(opts.ifRevision),
    }),
  );
}

export async function taskBlock(
  id: string,
  opts: { reason?: string; until?: string; ifRevision?: string },
): Promise<void> {
  emitJson(
    await request("POST", `/v1/tasks/${encodeURIComponent(id)}/block`, {
      reason: opts.reason,
      until: opts.until,
      ifRevision: parseIfRevision(opts.ifRevision),
    }),
  );
}

export async function taskComplete(id: string, opts: { evidence?: string; ifRevision?: string }): Promise<void> {
  emitJson(
    await request("POST", `/v1/tasks/${encodeURIComponent(id)}/complete`, {
      evidence: opts.evidence,
      ifRevision: parseIfRevision(opts.ifRevision),
    }),
  );
}

export async function taskRelease(id: string, opts: { ifRevision?: string }): Promise<void> {
  emitJson(
    await request("POST", `/v1/tasks/${encodeURIComponent(id)}/release`, {
      ifRevision: parseIfRevision(opts.ifRevision),
    }),
  );
}
