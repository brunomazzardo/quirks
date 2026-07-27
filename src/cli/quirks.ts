#!/usr/bin/env node
/**
 * `quirks` — the unified CLI the reboot collapses to.
 *
 * It starts with `goal` because goals are the object above a task, and the
 * one the product was missing. `task`, `run`, `status`, and `report` migrate
 * in here rather than becoming further binaries; quirks-tasks, -campaign,
 * and -watchdog stay until they do.
 *
 * Nothing on the execution path is interactive: flags and files in, JSON out.
 */
import { QuirksError } from "../core/errors.js";
import { loadProjectContext } from "../project/config.js";
import { createTaskSource } from "../task-source/factory.js";
import { disposeTaskSource, type TaskSource } from "../task-source/task-source.js";
import { goalRevision } from "../task-source/json/json-goal-mutations.js";
import type { NativeGoal } from "../task-source/types.js";
import { deriveGoals, findGoal, type GoalMemberTask } from "../goals/read-model.js";
import { CliParseError } from "./args.js";
import { exitCodeForError, quirksErrorCodeFromString, writeHuman, writeJson } from "./output.js";

type GoalSub = "list" | "show" | "new" | "done" | "abandon";

interface ParsedArgs {
  readonly command: "goal";
  readonly sub: GoalSub;
  readonly goalId?: string;
  readonly title?: string;
  readonly why?: string;
  readonly doneWhen: readonly string[];
  readonly reason?: string;
  readonly json: boolean;
  readonly configPath?: string;
}

const USAGE = [
  "usage: quirks goal list [--json]",
  "       quirks goal show <goal-id> [--json]",
  "       quirks goal new <goal-id> --title <text> [--why <text>] [--done-when <text>]...",
  "       quirks goal done <goal-id> --reason <text>",
  "       quirks goal abandon <goal-id> --reason <text>",
].join("\n");

const SUBS: ReadonlySet<string> = new Set(["list", "show", "new", "done", "abandon"]);

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const doneWhen: string[] = [];
  let json = false;
  let configPath: string | undefined;
  let title: string | undefined;
  let why: string | undefined;
  let reason: string | undefined;

  const takeValue = (i: number, flag: string): string => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("-")) throw new CliParseError(`Missing value for ${flag}`);
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--json") {
      json = true;
    } else if (arg === "--config") {
      configPath = takeValue(i, arg);
      i += 1;
    } else if (arg === "--title") {
      title = takeValue(i, arg);
      i += 1;
    } else if (arg === "--why") {
      why = takeValue(i, arg);
      i += 1;
    } else if (arg === "--done-when") {
      doneWhen.push(takeValue(i, arg));
      i += 1;
    } else if (arg === "--reason") {
      reason = takeValue(i, arg);
      i += 1;
    } else if (arg.startsWith("-")) {
      throw new CliParseError(`Unknown flag: ${arg}\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional[0] !== "goal") throw new CliParseError(USAGE);
  const sub = positional[1];
  if (sub === undefined || !SUBS.has(sub)) throw new CliParseError(USAGE);
  if (sub !== "list" && positional[2] === undefined) {
    throw new CliParseError(`goal ${sub} requires a goal id`);
  }
  if (sub === "new" && title === undefined) {
    throw new CliParseError("goal new requires --title");
  }
  // A goal leaving `active` must say why: the silent backlog is the failure
  // this object exists to make visible.
  if ((sub === "done" || sub === "abandon") && reason === undefined) {
    throw new CliParseError(`goal ${sub} requires --reason`);
  }

  return {
    command: "goal",
    sub: sub as GoalSub,
    ...(positional[2] === undefined ? {} : { goalId: positional[2] }),
    ...(title === undefined ? {} : { title }),
    ...(why === undefined ? {} : { why }),
    doneWhen,
    ...(reason === undefined ? {} : { reason }),
    json,
    ...(configPath === undefined ? {} : { configPath }),
  };
}

async function listTasks(source: TaskSource): Promise<readonly GoalMemberTask[]> {
  const response = await source.execute({ schemaVersion: 1, operation: "list", input: {} });
  if (!response.ok) {
    throw new QuirksError(quirksErrorCodeFromString(response.error.code), response.error.message);
  }
  if (response.operation !== "list") {
    throw new QuirksError("PROTOCOL_VIOLATION", `Unexpected operation ${response.operation}`);
  }
  const raw = (response.data as { tasks: Record<string, unknown>[] }).tasks;
  return raw.map((task) => ({
    id: String(task.id),
    status: String(task.status),
    title: String(task.title ?? ""),
    ...(task.priority === undefined ? {} : { priority: String(task.priority) }),
  }));
}

async function listGoalRecords(source: TaskSource): Promise<readonly NativeGoal[]> {
  const response = await source.execute({ schemaVersion: 1, operation: "list-goals", input: {} });
  // A driver whose provider has no grouping concept says so; the rollup then
  // falls back to what the task ids carry rather than failing.
  if (!response.ok) return [];
  return (response.data as { goals: NativeGoal[] }).goals;
}

async function readGoalRecord(source: TaskSource, goalId: string): Promise<NativeGoal | undefined> {
  const response = await source.execute({ schemaVersion: 1, operation: "show-goal", goalId, input: {} });
  if (!response.ok) return undefined;
  return response.data as NativeGoal;
}

/**
 * Goal writes. The idempotency key carries the goal and the verb so a repeated
 * invocation is recognised rather than re-applied — the same discipline task
 * mutations use.
 */
async function writeGoal(source: TaskSource, parsed: ParsedArgs, json: boolean): Promise<number> {
  const goalId = parsed.goalId!;
  const now = new Date().toISOString();
  const idempotencyKey = `goal:${goalId}:${parsed.sub}:${now}`;

  let response;
  if (parsed.sub === "new") {
    response = await source.execute({
      schemaVersion: 1,
      operation: "propose-goal",
      goalId,
      idempotencyKey,
      input: {
        goal: {
          id: goalId,
          title: parsed.title!,
          ...(parsed.why === undefined ? {} : { why: parsed.why }),
          ...(parsed.doneWhen.length === 0 ? {} : { doneWhen: parsed.doneWhen }),
          state: "active",
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  } else {
    const current = await readGoalRecord(source, goalId);
    if (!current) {
      process.stderr.write(`No goal record for ${goalId} — create it with: quirks goal new ${goalId} --title ...\n`);
      return 3;
    }
    response = await source.execute({
      schemaVersion: 1,
      operation: "update-goal",
      goalId,
      expectedNativeRevision: goalRevision(current),
      idempotencyKey,
      input: { state: parsed.sub === "done" ? "done" : "abandoned", stateReason: parsed.reason! },
    });
  }

  if (!response.ok) {
    if (json) writeJson(process.stdout, { ok: false, error: response.error });
    else process.stderr.write(`${response.error.code}: ${response.error.message}\n`);
    return 3;
  }

  const goal = response.data as NativeGoal;
  if (json) writeJson(process.stdout, { ok: true, goal });
  else writeHuman(process.stdout, [`${goal.id}\t${goal.state}\t${goal.title}`]);
  return 0;
}

const STATE_LABEL: Record<string, string> = {
  not_started: "not started",
  in_progress: "in progress",
  stalled: "STALLED",
  all_tasks_done: "all tasks done",
};

async function run(): Promise<number> {
  let json = false;
  let source: TaskSource | undefined;
  try {
    const parsed = parseArgs(process.argv.slice(2));
    json = parsed.json;

    const context = await loadProjectContext(process.cwd(), {
      mode: "inspection",
      ...(parsed.configPath ? { configPath: parsed.configPath } : {}),
    });
    source = await createTaskSource(context);
    const goals = deriveGoals(await listTasks(source));

    if (parsed.sub === "list") {
      // A goal you declared but have not broken into tasks yet is exactly the
      // intent this object exists to hold, so the rollup is the UNION of
      // recorded goals and goals the task ids imply — never only one side.
      const records = await listGoalRecords(source);
      const rows = [
        ...goals.map((g) => ({
          id: g.id,
          total: g.total,
          done: g.done,
          open: g.open,
          blocked: g.blocked,
          derived: g.state,
          declared: records.find((r) => r.id === g.id)?.state,
          title: records.find((r) => r.id === g.id)?.title,
        })),
        ...records
          .filter((r) => !goals.some((g) => g.id === r.id))
          .map((r) => ({
            id: r.id,
            total: 0,
            done: 0,
            open: 0,
            blocked: 0,
            derived: "not_started" as const,
            declared: r.state,
            title: r.title,
          })),
      ];

      if (json) {
        writeJson(process.stdout, { ok: true, goals: rows });
      } else {
        writeHuman(process.stdout, [
          "goal          total  done  open  blocked   state",
          ...rows.map((r) =>
            r.id.padEnd(13) +
            String(r.total).padStart(5) +
            String(r.done).padStart(6) +
            String(r.open).padStart(6) +
            String(r.blocked).padStart(8) +
            "   " +
            // The declared state wins when someone asserted one: "all tasks
            // done" is not the same claim as a goal being achieved.
            (r.declared && r.declared !== "active" ? r.declared : (STATE_LABEL[r.derived] ?? r.derived)) +
            (r.total === 0 ? "  (no tasks yet)" : ""),
          ),
        ]);
      }
      return 0;
    }

    if (parsed.sub === "show") {
      const goal = findGoal(goals, parsed.goalId!);
      const record = await readGoalRecord(source, parsed.goalId!);
      if (!goal && !record) {
        process.stderr.write(`No goal ${parsed.goalId} — no record, and no task id carries that prefix\n`);
        return 3;
      }

      if (json) {
        writeJson(process.stdout, { ok: true, goal: goal ?? null, record: record ?? null });
      } else {
        writeHuman(process.stdout, [
          `goal: ${parsed.goalId}`,
          ...(record
            ? [
                `title: ${record.title}`,
                `state: ${record.state}${record.stateReason ? ` — ${record.stateReason}` : ""}`,
                ...(record.why ? [`why: ${record.why}`] : []),
                ...(record.doneWhen?.length ? ["doneWhen:", ...record.doneWhen.map((c) => `  - ${c}`)] : []),
              ]
            : ["(no goal record yet — derived from task ids only)"]),
          ...(goal
            ? [
                `tasks: ${goal.total} total, ${goal.done} done, ${goal.open} open, ${goal.blocked} blocked`,
                `derived: ${STATE_LABEL[goal.state] ?? goal.state}`,
                "",
                ...goal.tasks.map((t) => `${t.id}\t${t.status}\t${t.title}`),
              ]
            : ["tasks: none carry this prefix yet"]),
        ]);
      }
      return 0;
    }

    return writeGoal(source, parsed, json);
  } catch (error) {
    if (error instanceof CliParseError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    const exitCode = exitCodeForError(error);
    process.stderr.write(`${error instanceof Error ? error.message : "Unexpected failure"}\n`);
    return exitCode;
  } finally {
    await disposeTaskSource(source);
  }
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unexpected failure"}\n`);
    process.exitCode = 1;
  });
