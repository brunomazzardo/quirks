// quirks — the CLI.
//
// Argv parsing is commander's; everything behind it is Effect. Each action is a
// thin adapter: parse flags, run one Effect, and let `runVerb` decide what a
// typed failure prints. A verb that reaches for data reaches for HTTP (D4) —
// this file imports no store, no ops, no service.
//
// The `#!/usr/bin/env node` banner is added at pack time; node runs the .ts
// directly for development.

import { Command } from "commander";
import * as Effect from "effect/Effect";
import { goalAbandon, goalDone, goalList, goalNew, goalShow } from "./cli/Goal.ts";
import {
  taskBlock,
  taskClaim,
  taskComplete,
  taskList,
  taskPropose,
  taskRelease,
  taskShow,
} from "./cli/Task.ts";
import { runList, runShow, runStart } from "./cli/Run.ts";
import { harnessShow } from "./cli/Harness.ts";
import {
  daemonRestart,
  daemonServe,
  daemonStart,
  daemonStatus,
  daemonStop,
  notBuilt,
} from "./cli/Daemon.ts";
import type { CliError } from "./cli/Output.ts";
import type { ServiceError } from "./cli/Client.ts";

/**
 * The error boundary. A `CliError` or `ServiceError` is something the user did
 * or the service said: one line, exit 1, no stack. Anything else is a defect and
 * keeps its stack, because a crash dressed up as a refusal is how a bug becomes
 * folklore.
 */
const runVerb = (effect: Effect.Effect<void, CliError | ServiceError>): Promise<void> =>
  Effect.runPromise(
    effect.pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(`quirks: ${error.message}`);
          process.exit(1);
        }),
      ),
    ),
  );

const collect = (value: string, prev: string[]): string[] => [...prev, value];

const program = new Command("quirks")
  .description(
    "goal → task → run — what I am trying to achieve, what needs doing, when agents did it",
  )
  .addHelpText(
    "after",
    "\nReads print a table on a TTY and JSON when piped or given --json." +
      "\nWrites always print the resulting object as JSON. Nothing prompts.",
  );

const goal = program.command("goal").description("long-lived intent — never executable");

goal
  .command("list")
  .description("the rollup: every goal, recorded or implied by task ids")
  .option("--json", "JSON even on a TTY", false)
  .option("--all", "include done and abandoned goals", false)
  .action((opts) => runVerb(goalList(opts)));

goal
  .command("show")
  .description("one goal: why, doneWhen, member tasks")
  .argument("<id>", "goal id, e.g. QK-SRV")
  .option("--json", "JSON even on a TTY", false)
  .action((id, opts) => runVerb(goalShow(id, opts)));

goal
  .command("new")
  .description("record a goal (the brainstorm skill converses; this records)")
  .argument("<id>", "the task-id prefix this goal owns, e.g. QK-SRV")
  .requiredOption("--title <title>", "what this goal is")
  .option("--why <sentence>", "one sentence of intent (never a copied body)")
  .option("--why-ref <path>", "pointer to the spec, pinned at the current commit")
  .option("--done-when <criterion>", "asserted completion criterion (repeatable)", collect, [])
  .action((id, opts) => runVerb(goalNew(id, opts)));

goal
  .command("done")
  .description("assert the doneWhen criteria are met")
  .argument("<id>")
  .option("--reason <reason>", "required: why this counts as done")
  .action((id, opts) => runVerb(goalDone(id, opts)));

goal
  .command("abandon")
  .description("stop lying to yourself about a dropped direction")
  .argument("<id>")
  .option("--reason <reason>", "required: why this direction is dropped")
  .action((id, opts) => runVerb(goalAbandon(id, opts)));

const task = program.command("task").description("units of work — never approved");

task
  .command("propose")
  .description("create a live task (there is no acceptance state)")
  .requiredOption("--title <title>", "what needs doing")
  .option("--goal <id>", "goal prefix to mint under; omit for a bare QK-nnn id")
  .option("--depends-on <ids>", "task ids, repeatable or comma-separated", collect, [])
  .option("--deliverable <text>", "repeatable", collect, [])
  .option("--criterion <text>", "acceptance criterion, repeatable", collect, [])
  .option("--verify <command>", "verification command, repeatable", collect, [])
  .option(
    "--source <path>",
    "source document, pinned at the current commit, repeatable",
    collect,
    [],
  )
  .option("--effort <text>", "free text, no ceremony")
  .option("--risk <text>", "free text, no ceremony")
  .option("--needs-design", "we do not yet know what to build", false)
  .option("--needs-breakdown", "we know what, but it is too big as one task", false)
  .option(
    "--future",
    "deliberately not now — excluded from open counts, distinct from blocked",
    false,
  )
  .action((opts) => runVerb(taskPropose(opts)));

task
  .command("list")
  .description("the backlog")
  .option("--json", "JSON even on a TTY", false)
  .option("--goal <id>", "only this goal's tasks ('(no goal)' for bare)")
  .option("--status <status>", "open | claimed | blocked | completed")
  .action((opts) => runVerb(taskList(opts)));

task
  .command("show")
  .description("one task, in full (always JSON — every field matters)")
  .argument("<id>")
  .action((id) => runVerb(taskShow(id)));

task
  .command("claim")
  .description("take ownership; refuses while dependencies are incomplete")
  .argument("<id>")
  .option("--by <who>", "who is claiming")
  .option("--force", "claim despite incomplete dependencies", false)
  .option("--if-revision <n>", "fail if the task moved past this revision")
  .action((id, opts) => runVerb(taskClaim(id, opts)));

task
  .command("block")
  .description("park a task, remembering what it interrupted")
  .argument("<id>")
  .option("--reason <reason>", "required")
  .option("--until <when>", "free text, e.g. a date or a condition")
  .option("--if-revision <n>", "fail if the task moved past this revision")
  .action((id, opts) => runVerb(taskBlock(id, opts)));

task
  .command("complete")
  .description("record completion (permissive — hand-finished work needs no ceremony)")
  .argument("<id>")
  .option("--evidence <text>", "what proves it (quote-verified once runs exist)")
  .option("--if-revision <n>", "fail if the task moved past this revision")
  .action((id, opts) => runVerb(taskComplete(id, opts)));

task
  .command("release")
  .description("claimed → open; blocked → whatever it interrupted")
  .argument("<id>")
  .option("--if-revision <n>", "fail if the task moved past this revision")
  .action((id, opts) => runVerb(taskRelease(id, opts)));

const run = program
  .command("run")
  .description("the only thing approved — a named grouping of tasks");

run
  .command("list")
  .description("runs in this repo")
  .option("--json", "JSON even on a TTY", false)
  .action((opts) => runVerb(runList(opts)));

run
  .command("show")
  .description("one run by id or slug (always JSON)")
  .argument("<id-or-slug>")
  .action((idOrSlug) => runVerb(runShow(idOrSlug)));

// `quirks run QK-A QK-B --name …` — task ids as variadic args on the default action.
run
  .argument("[tasks...]", "task ids to include; omit when using --goal")
  .option("--name <name>", "required: names the run and yields its slug")
  .option("--goal <id>", "every ready task under this goal, in dependency order")
  .option("--mode <mode>", "autonomous | park-on-issue", "park-on-issue")
  .option("--yes", "approve the plan without prompting (required when not a TTY)", false)
  .option("--dry-run", "assemble every brief without dispatching or persisting", false)
  .option(
    "--approve-only",
    "with --yes, persist the approved run but do not execute parents",
    false,
  )
  .option("--resume <id-or-slug>", "continue an interrupted run (no new approval)")
  .option("--json", "JSON even on a TTY", false)
  .action((tasks, opts) => runVerb(runStart(tasks, opts)));

program
  .command("serve", { hidden: true })
  .description("run the service in the foreground (the CLI autostarts this detached)")
  .option("--port <port>", "override the derived per-repo port")
  .action((opts) => runVerb(daemonServe(opts)));

const daemon = program
  .command("daemon")
  .description("the local service: what code it is running, and promoting a new tree");

daemon
  .command("status")
  .description("is it up, what code is it serving, and has your tree drifted from it")
  .option("--json", "JSON even on a TTY", false)
  .action((opts) => runVerb(daemonStatus(opts)));

daemon
  .command("start")
  .description("bring the service up without running a verb through it")
  .action(() => runVerb(daemonStart));

daemon
  .command("stop")
  .description("release the socket; the next quirks command starts a fresh one")
  .option("--force", "stop even while runs are executing (they can be resumed)", false)
  .action((opts) => runVerb(daemonStop(opts)));

daemon
  .command("restart")
  .description("promote the current working tree into a fresh snapshot and rebind")
  .option("--force", "restart even while runs are executing (they can be resumed)", false)
  .option("--json", "JSON even on a TTY", false)
  .action((opts) => runVerb(daemonRestart(opts)));

program
  .command("harness")
  .description("is each harness present, usable, answering — and what each tier resolves to")
  .option("--json", "JSON even on a TTY", false)
  .option("--probe", "also run --version against each present harness", false)
  .action((opts) => runVerb(harnessShow(opts)));

for (const coming of ["status", "report"]) {
  program
    .command(coming, { hidden: true })
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(() => runVerb(notBuilt(coming)));
}

await program.parseAsync();
