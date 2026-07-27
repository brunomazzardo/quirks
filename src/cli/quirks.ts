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
import { deriveGoals, findGoal, type GoalMemberTask } from "../goals/read-model.js";
import { CliParseError } from "./args.js";
import { exitCodeForError, quirksErrorCodeFromString, writeHuman, writeJson } from "./output.js";

interface ParsedArgs {
  readonly command: "goal";
  readonly sub: "list" | "show";
  readonly goalId?: string;
  readonly json: boolean;
  readonly configPath?: string;
}

const USAGE = [
  "usage: quirks goal list [--json]",
  "       quirks goal show <goal-id> [--json]",
].join("\n");

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  let json = false;
  let configPath: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--json") {
      json = true;
    } else if (arg === "--config") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) throw new CliParseError("Missing value for --config");
      configPath = value;
      i += 1;
    } else if (arg.startsWith("-")) {
      throw new CliParseError(`Unknown flag: ${arg}\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional[0] !== "goal") throw new CliParseError(USAGE);
  const sub = positional[1];
  if (sub !== "list" && sub !== "show") throw new CliParseError(USAGE);
  if (sub === "show" && positional[2] === undefined) {
    throw new CliParseError("goal show requires a goal id");
  }

  return {
    command: "goal",
    sub,
    ...(positional[2] === undefined ? {} : { goalId: positional[2] }),
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
      if (json) {
        // Members are omitted here on purpose: `list` is the rollup, and
        // carrying every task would make the common case the largest payload.
        writeJson(process.stdout, {
          ok: true,
          goals: goals.map(({ tasks: _tasks, ...goal }) => goal),
        });
      } else {
        writeHuman(process.stdout, [
          "goal          total  done  open  blocked   state",
          ...goals.map((g) =>
            g.id.padEnd(13) +
            String(g.total).padStart(5) +
            String(g.done).padStart(6) +
            String(g.open).padStart(6) +
            String(g.blocked).padStart(8) +
            "   " + (STATE_LABEL[g.state] ?? g.state),
          ),
        ]);
      }
      return 0;
    }

    const goal = findGoal(goals, parsed.goalId!);
    if (!goal) {
      process.stderr.write(`No goal ${parsed.goalId} — no task id carries that prefix\n`);
      return 3;
    }

    if (json) {
      writeJson(process.stdout, { ok: true, goal });
    } else {
      writeHuman(process.stdout, [
        `goal: ${goal.id}`,
        `state: ${STATE_LABEL[goal.state] ?? goal.state}`,
        `tasks: ${goal.total} total, ${goal.done} done, ${goal.open} open, ${goal.blocked} blocked`,
        "",
        ...goal.tasks.map((t) => `${t.id}\t${t.status}\t${t.title}`),
      ]);
    }
    return 0;
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
