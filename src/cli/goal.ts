// The goal verbs: flag parsing and rendering only — every byte of data goes
// through the HTTP client. No store import may ever appear in this file.

import { request } from "./client.ts";
import { emitJson, emitRead, table } from "./output.ts";

interface GoalRollup {
  id: string;
  title: string | null;
  recorded: boolean;
  state: string;
  total: number;
  done: number;
  open: number;
  blocked: number;
  future: number;
}

function renderRollup(shown: GoalRollup[], omitted: number): string {
  const body = table(
    ["goal", "total", "done", "open", "blocked", "future", "state"],
    shown.map((r) => [
      r.id,
      String(r.total),
      String(r.done),
      String(r.open),
      String(r.blocked),
      String(r.future),
      r.state,
    ]),
  );
  return omitted > 0 ? `${body}\n… ${omitted} done/abandoned goals omitted (--all)` : body;
}

export async function goalList(opts: { json: boolean; all: boolean }): Promise<void> {
  const rows: GoalRollup[] = (await request("GET", "/v1/goals?all=true&limit=1000")).items;
  const shown = opts.all ? rows : rows.filter((r) => r.state !== "done" && r.state !== "abandoned");
  emitRead(shown, opts.json, () => renderRollup(shown, rows.length - shown.length));
}

export async function goalShow(id: string, opts: { json: boolean }): Promise<void> {
  const { goal, tasks } = await request("GET", `/v1/goals/${encodeURIComponent(id)}`);
  emitRead({ goal, tasks }, opts.json, () => {
    const lines = [
      `${goal.id} — ${goal.title}   [${goal.state}${goal.stateReason ? `: ${goal.stateReason}` : ""}]`,
    ];
    if (goal.why.text) lines.push(`why: ${goal.why.text}`);
    if (goal.why.ref) {
      lines.push(`why: ${goal.why.ref.path} @ ${goal.why.ref.pinnedCommit?.slice(0, 7) ?? "unpinned"}`);
    }
    for (const c of goal.doneWhen) lines.push(`done when: ${c}`);
    lines.push("");
    lines.push(
      tasks.length === 0
        ? "no tasks yet"
        : table(
            ["task", "status", "title"],
            tasks.map((t: { id: string; status: string; title: string }) => [t.id, t.status, t.title]),
          ),
    );
    return lines.join("\n");
  });
}

export async function goalNew(
  id: string,
  opts: { title: string; why?: string; whyRef?: string; doneWhen: string[] },
): Promise<void> {
  emitJson(await request("POST", "/v1/goals", { id, ...opts }));
}

export async function goalDone(id: string, opts: { reason?: string }): Promise<void> {
  emitJson(await request("POST", `/v1/goals/${encodeURIComponent(id)}/done`, { reason: opts.reason }));
}

export async function goalAbandon(id: string, opts: { reason?: string }): Promise<void> {
  emitJson(await request("POST", `/v1/goals/${encodeURIComponent(id)}/abandon`, { reason: opts.reason }));
}
