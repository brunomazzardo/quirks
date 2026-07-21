export type CampaignCommand =
  | "preflight"
  | "approve"
  | "start"
  | "status"
  | "attach"
  | "resume"
  | "cancel"
  | "ui";

export class CampaignCliParseError extends Error {
  override readonly name = "CampaignCliParseError";
}

export type ParsedCampaignArgs =
  | { command: "preflight"; taskIds: string[]; configPath?: string; externalRouting: boolean; json: boolean }
  | { command: "approve"; campaignId: string; digest: string; json: boolean }
  | { command: "start"; campaignId: string; json: boolean }
  | { command: "status"; campaignId: string; json: boolean }
  | { command: "attach"; campaignId: string; json: boolean }
  | { command: "resume"; campaignId: string; json: boolean }
  | { command: "cancel"; campaignId: string; scope?: string; json: boolean }
  | { command: "ui"; uiArgv: string[] };

const COMMANDS = new Set<CampaignCommand>([
  "preflight",
  "approve",
  "start",
  "status",
  "attach",
  "resume",
  "cancel",
  "ui",
]);

function takeValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new CampaignCliParseError(`Missing value for ${flag}`);
  }
  return value;
}

function parsePreflight(argv: readonly string[]): Extract<ParsedCampaignArgs, { command: "preflight" }> {
  const taskIds: string[] = [];
  let configPath: string | undefined;
  let externalRouting = false;
  let json = false;
  let sawExternalRouting = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--json") {
      if (json) throw new CampaignCliParseError("Duplicate flag --json");
      json = true;
      continue;
    }
    if (token === "--task") {
      taskIds.push(takeValue(argv, index, "--task"));
      index += 1;
      continue;
    }
    if (token === "--config") {
      if (configPath !== undefined) throw new CampaignCliParseError("Duplicate flag --config");
      configPath = takeValue(argv, index, "--config");
      index += 1;
      continue;
    }
    if (token === "--external-routing") {
      if (sawExternalRouting) throw new CampaignCliParseError("Duplicate external routing flag");
      externalRouting = true;
      sawExternalRouting = true;
      continue;
    }
    if (token === "--no-external-routing") {
      if (sawExternalRouting) throw new CampaignCliParseError("Duplicate external routing flag");
      externalRouting = false;
      sawExternalRouting = true;
      continue;
    }
    if (token.startsWith("--")) throw new CampaignCliParseError(`Unknown option ${token}`);
    throw new CampaignCliParseError(`Unexpected argument ${token}`);
  }

  if (taskIds.length === 0) throw new CampaignCliParseError("preflight requires at least one --task");
  return { command: "preflight", taskIds, ...(configPath ? { configPath } : {}), externalRouting, json };
}

function parseCampaignScoped(
  command: Exclude<CampaignCommand, "preflight" | "ui">,
  argv: readonly string[],
  extra?: (token: string, argv: readonly string[], index: number) => number | "handled",
): ParsedCampaignArgs {
  let campaignId: string | undefined;
  let digest: string | undefined;
  let scope: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--json") {
      if (json) throw new CampaignCliParseError("Duplicate flag --json");
      json = true;
      continue;
    }
    if (token === "--campaign") {
      if (campaignId !== undefined) throw new CampaignCliParseError("Duplicate flag --campaign");
      campaignId = takeValue(argv, index, "--campaign");
      index += 1;
      continue;
    }
    if (token === "--digest") {
      if (digest !== undefined) throw new CampaignCliParseError("Duplicate flag --digest");
      digest = takeValue(argv, index, "--digest");
      index += 1;
      continue;
    }
    if (token === "--scope") {
      if (scope !== undefined) throw new CampaignCliParseError("Duplicate flag --scope");
      scope = takeValue(argv, index, "--scope");
      index += 1;
      continue;
    }
    if (extra) {
      const result = extra(token, argv, index);
      if (result === "handled") continue;
      if (typeof result === "number") {
        index = result;
        continue;
      }
    }
    if (token.startsWith("--")) throw new CampaignCliParseError(`Unknown option ${token}`);
    throw new CampaignCliParseError(`Unexpected argument ${token}`);
  }

  if (!campaignId) throw new CampaignCliParseError(`${command} requires --campaign <id>`);
  if (command === "approve" && !digest) throw new CampaignCliParseError("approve requires --digest <digest>");

  switch (command) {
    case "approve":
      return { command, campaignId, digest: digest!, json };
    case "cancel":
      return { command, campaignId, ...(scope ? { scope } : {}), json };
    default:
      return { command, campaignId, json } as ParsedCampaignArgs;
  }
}

export function parseCampaignArgs(argv: readonly string[]): ParsedCampaignArgs {
  if (argv.length === 0) throw new CampaignCliParseError("Missing command");
  const command = argv[0] as CampaignCommand;
  if (!COMMANDS.has(command)) throw new CampaignCliParseError(`Unknown command ${argv[0]}`);
  const rest = argv.slice(1);
  if (command === "ui") return { command: "ui", uiArgv: rest };
  if (command === "preflight") return parsePreflight(rest);
  return parseCampaignScoped(command, rest);
}
