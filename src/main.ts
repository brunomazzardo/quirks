#!/usr/bin/env bun
import { Command } from "commander";
import {
  goalAbandon,
  goalDone,
  goalList,
  goalNew,
  goalShow,
} from "./cli/goal.ts";
import {
  taskBlock,
  taskClaim,
  taskComplete,
  taskList,
  taskPropose,
  taskRelease,
  taskShow,
} from "./cli/task.ts";
import { CliError } from "./cli/output.ts";
import { StoreCorruptError } from "./store/json-file.ts";
import { TransitionError } from "./store/transitions.ts";

const collect = (value: string, prev: string[]): string[] => [...prev, value];

const program = new Command("quirks")
  .description("goal → task → run — what I am trying to achieve, what needs doing, when agents did it")
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
  .action(goalList);

goal
  .command("show")
  .description("one goal: why, doneWhen, member tasks")
  .argument("<id>", "goal id, e.g. QK-SRV")
  .option("--json", "JSON even on a TTY", false)
  .action(goalShow);

goal
  .command("new")
  .description("record a goal (the brainstorm skill converses; this records)")
  .argument("<id>", "the task-id prefix this goal owns, e.g. QK-SRV")
  .requiredOption("--title <title>", "what this goal is")
  .option("--why <sentence>", "one sentence of intent (never a copied body)")
  .option("--why-ref <path>", "pointer to the spec, pinned at the current commit")
  .option("--done-when <criterion>", "asserted completion criterion (repeatable)", collect, [])
  .action(goalNew);

goal
  .command("done")
  .description("assert the doneWhen criteria are met")
  .argument("<id>")
  .option("--reason <reason>", "required: why this counts as done")
  .action(goalDone);

goal
  .command("abandon")
  .description("stop lying to yourself about a dropped direction")
  .argument("<id>")
  .option("--reason <reason>", "required: why this direction is dropped")
  .action(goalAbandon);

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
  .option("--source <path>", "source document, pinned at the current commit, repeatable", collect, [])
  .option("--effort <text>", "free text, no ceremony")
  .option("--risk <text>", "free text, no ceremony")
  .option("--needs-design", "we do not yet know what to build", false)
  .option("--needs-breakdown", "we know what, but it is too big as one task", false)
  .action(taskPropose);

task
  .command("list")
  .description("the backlog")
  .option("--json", "JSON even on a TTY", false)
  .option("--goal <id>", "only this goal's tasks ('(no goal)' for bare)")
  .option("--status <status>", "open | claimed | blocked | completed")
  .action(taskList);

task
  .command("show")
  .description("one task, in full (always JSON — every field matters)")
  .argument("<id>")
  .action(taskShow);

task
  .command("claim")
  .description("take ownership; refuses while dependencies are incomplete")
  .argument("<id>")
  .option("--by <who>", "who is claiming")
  .option("--force", "claim despite incomplete dependencies", false)
  .option("--if-revision <n>", "fail if the task moved past this revision")
  .action(taskClaim);

task
  .command("block")
  .description("park a task, remembering what it interrupted")
  .argument("<id>")
  .option("--reason <reason>", "required")
  .option("--until <when>", "free text, e.g. a date or a condition")
  .option("--if-revision <n>", "fail if the task moved past this revision")
  .action(taskBlock);

task
  .command("complete")
  .description("record completion (permissive — hand-finished work needs no ceremony)")
  .argument("<id>")
  .option("--evidence <text>", "what proves it (quote-verified once runs exist)")
  .option("--if-revision <n>", "fail if the task moved past this revision")
  .action(taskComplete);

task
  .command("release")
  .description("claimed → open; blocked → whatever it interrupted")
  .argument("<id>")
  .option("--if-revision <n>", "fail if the task moved past this revision")
  .action(taskRelease);

for (const coming of ["run", "status", "report", "harness"]) {
  program
    .command(coming, { hidden: true })
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(() => {
      throw new CliError(`quirks ${coming} is not built yet — step 1 covers goal and task`);
    });
}

try {
  program.parse();
} catch (err) {
  if (err instanceof CliError || err instanceof TransitionError || err instanceof StoreCorruptError) {
    console.error(`quirks: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
