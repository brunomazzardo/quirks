import { assertRepositoryRelativePath } from "../core/repository-path.js";

export type MutationCommand =
  | "propose"
  | "claim"
  | "submit-review"
  | "attach-provenance"
  | "complete"
  | "block"
  | "release";

export type Command = "validate" | "list" | "show" | "sync" | "claim-candidate" | MutationCommand;

export class CliParseError extends Error {
  override readonly name = "CliParseError";
}

export interface ParsedArgs {
  command: Command;
  configPath?: string;
  status?: string;
  taskId?: string;
  taskFile?: string;
  idempotencyKey?: string;
  requestFile?: string;
  json: boolean;
}

const COMMANDS = new Set<Command>([
  "validate",
  "list",
  "show",
  "sync",
  "claim-candidate",
  "propose",
  "claim",
  "submit-review",
  "attach-provenance",
  "complete",
  "block",
  "release",
]);

// Runtime view of the parser table for the skill validator cross-check.
export const TASK_CLI_COMMANDS: ReadonlySet<string> = COMMANDS;

const MUTATION_COMMANDS = new Set<MutationCommand>([
  "propose",
  "claim",
  "submit-review",
  "attach-provenance",
  "complete",
  "block",
  "release",
]);

export function isMutationCommand(command: Command): command is MutationCommand {
  return MUTATION_COMMANDS.has(command as MutationCommand);
}

function takeValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new CliParseError(`Missing value for ${flag}`);
  }
  return value;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  if (argv.length === 0) {
    throw new CliParseError("Missing command");
  }

  const command = argv[0];
  if (!COMMANDS.has(command as Command)) {
    throw new CliParseError(`Unknown command ${command}`);
  }

  let configPath: string | undefined;
  let status: string | undefined;
  let taskId: string | undefined;
  let taskFile: string | undefined;
  let idempotencyKey: string | undefined;
  let requestFile: string | undefined;
  let json = false;
  const positionals: string[] = [];

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--json") {
      if (json) throw new CliParseError("Duplicate flag --json");
      json = true;
      continue;
    }
    if (token === "--config") {
      if (configPath !== undefined) throw new CliParseError("Duplicate flag --config");
      configPath = takeValue(argv, index, "--config");
      index += 1;
      continue;
    }
    if (token === "--status") {
      if (status !== undefined) throw new CliParseError("Duplicate flag --status");
      status = takeValue(argv, index, "--status");
      index += 1;
      continue;
    }
    if (token === "--task-file") {
      if (taskFile !== undefined) throw new CliParseError("Duplicate flag --task-file");
      taskFile = takeValue(argv, index, "--task-file");
      index += 1;
      continue;
    }
    if (token === "--idempotency-key") {
      if (idempotencyKey !== undefined) throw new CliParseError("Duplicate flag --idempotency-key");
      idempotencyKey = takeValue(argv, index, "--idempotency-key");
      index += 1;
      continue;
    }
    if (token === "--request-file") {
      if (requestFile !== undefined) throw new CliParseError("Duplicate flag --request-file");
      try {
        requestFile = assertRepositoryRelativePath(takeValue(argv, index, "--request-file"));
      } catch {
        throw new CliParseError("request file must be repository-relative");
      }
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      throw new CliParseError(`Unknown option ${token}`);
    }
    if (token.startsWith("-")) {
      throw new CliParseError(`Unknown option ${token}`);
    }
    positionals.push(token);
  }

  if (status !== undefined && command !== "list") {
    throw new CliParseError("--status is only valid for list");
  }

  if (requestFile !== undefined && !MUTATION_COMMANDS.has(command as MutationCommand)) {
    throw new CliParseError("--request-file is only valid for mutation commands");
  }

  if ((taskFile !== undefined || idempotencyKey !== undefined) && command !== "propose") {
    throw new CliParseError("--task-file and --idempotency-key are only valid for propose");
  }

  if (command === "propose") {
    const semantic = taskFile !== undefined || idempotencyKey !== undefined || positionals.length > 0;
    const mutation = requestFile !== undefined;
    if (semantic && mutation) {
      throw new CliParseError("propose accepts either --request-file or --task-file/--idempotency-key, not both");
    }
    if (mutation) {
      if (positionals.length > 0) {
        throw new CliParseError("Unexpected positional arguments");
      }
    } else {
      if (positionals.length !== 1) {
        throw new CliParseError("propose requires exactly one task id");
      }
      if (!taskFile || !idempotencyKey) {
        throw new CliParseError("propose requires --task-file and --idempotency-key");
      }
      taskId = positionals[0];
    }
  } else if (MUTATION_COMMANDS.has(command as MutationCommand)) {
    if (requestFile === undefined) {
      throw new CliParseError(`${command} requires --request-file`);
    }
    if (positionals.length > 0) {
      throw new CliParseError("Unexpected positional arguments");
    }
  } else if (command === "show") {
    if (positionals.length !== 1) {
      throw new CliParseError("show requires exactly one task id");
    }
    taskId = positionals[0];
  } else if (positionals.length > 0) {
    throw new CliParseError("Unexpected positional arguments");
  }

  return {
    command: command as Command,
    ...(configPath ? { configPath } : {}),
    ...(status ? { status } : {}),
    ...(taskId ? { taskId } : {}),
    ...(taskFile ? { taskFile } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(requestFile ? { requestFile } : {}),
    json,
  };
}
