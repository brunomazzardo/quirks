export type CampaignCommand =
  | "preflight"
  | "approve"
  | "start"
  | "status"
  | "attach"
  | "resume"
  | "resume-candidate"
  | "cancel"
  | "ui";

export class CampaignCliParseError extends Error {
  override readonly name = "CampaignCliParseError";
}

export type ParsedCampaignArgs =
  | { command: "preflight"; taskIds: string[]; campaignId?: string; configPath?: string; externalRouting: boolean; maxConcurrency?: number; json: boolean }
  | { command: "approve"; campaignId: string; digest: string; json: boolean }
  | { command: "start"; campaignId: string; singleWave: boolean; json: boolean }
  | { command: "status"; campaignId: string; json: boolean }
  | { command: "attach"; campaignId: string; json: boolean }
  | { command: "resume"; campaignId: string; json: boolean }
  | { command: "resume-candidate"; json: boolean }
  | { command: "cancel"; campaignId: string; scope?: string; json: boolean }
  | { command: "ui"; uiArgv: string[] };

const COMMANDS = new Set<CampaignCommand>([
  "preflight",
  "approve",
  "start",
  "status",
  "attach",
  "resume",
  "resume-candidate",
  "cancel",
  "ui",
]);

// Runtime view of the parser table for the skill validator cross-check.
export const CAMPAIGN_CLI_COMMANDS: ReadonlySet<string> = COMMANDS;

function takeValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new CampaignCliParseError(`Missing value for ${flag}`);
  }
  return value;
}

// Campaign ids become branch names (quirks/<id>/integration) and state-dir
// path segments, so the operator-supplied override must stay git-branch and
// filesystem safe. Stricter than the envelope schema id (no ":").
const CAMPAIGN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function parsePreflight(argv: readonly string[]): Extract<ParsedCampaignArgs, { command: "preflight" }> {
  const taskIds: string[] = [];
  let campaignId: string | undefined;
  let configPath: string | undefined;
  let externalRouting = false;
  let maxConcurrency: number | undefined;
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
    if (token === "--campaign") {
      if (campaignId !== undefined) throw new CampaignCliParseError("Duplicate flag --campaign");
      campaignId = takeValue(argv, index, "--campaign");
      if (!CAMPAIGN_ID_PATTERN.test(campaignId)) {
        throw new CampaignCliParseError(
          "--campaign requires an id matching [A-Za-z0-9][A-Za-z0-9._-]{0,127}",
        );
      }
      index += 1;
      continue;
    }
    if (token === "--config") {
      if (configPath !== undefined) throw new CampaignCliParseError("Duplicate flag --config");
      configPath = takeValue(argv, index, "--config");
      index += 1;
      continue;
    }
    if (token === "--max-concurrency") {
      if (maxConcurrency !== undefined) throw new CampaignCliParseError("Duplicate flag --max-concurrency");
      const raw = takeValue(argv, index, "--max-concurrency");
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) {
        throw new CampaignCliParseError("--max-concurrency requires an integer >= 1");
      }
      maxConcurrency = value;
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
  return {
    command: "preflight",
    taskIds,
    ...(campaignId ? { campaignId } : {}),
    ...(configPath ? { configPath } : {}),
    externalRouting,
    ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
    json,
  };
}

function parseStart(argv: readonly string[]): Extract<ParsedCampaignArgs, { command: "start" }> {
  let campaignId: string | undefined;
  let singleWave = false;
  let sawSingleWave = false;
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
    if (token === "--single-wave") {
      if (sawSingleWave) throw new CampaignCliParseError("Duplicate flag --single-wave");
      singleWave = true;
      sawSingleWave = true;
      continue;
    }
    if (token.startsWith("--")) throw new CampaignCliParseError(`Unknown option ${token}`);
    throw new CampaignCliParseError(`Unexpected argument ${token}`);
  }

  if (!campaignId) throw new CampaignCliParseError("start requires --campaign <id>");
  return { command: "start", campaignId, singleWave, json };
}

function parseResumeCandidate(argv: readonly string[]): Extract<ParsedCampaignArgs, { command: "resume-candidate" }> {
  let json = false;
  for (const token of argv) {
    if (token === "--json") {
      if (json) throw new CampaignCliParseError("Duplicate flag --json");
      json = true;
      continue;
    }
    if (token.startsWith("--")) throw new CampaignCliParseError(`Unknown option ${token}`);
    throw new CampaignCliParseError(`Unexpected argument ${token}`);
  }
  return { command: "resume-candidate", json };
}

function parseCampaignScoped(
  command: Exclude<CampaignCommand, "preflight" | "start" | "resume-candidate" | "ui">,
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
  if (command === "start") return parseStart(rest);
  if (command === "resume-candidate") return parseResumeCandidate(rest);
  return parseCampaignScoped(command, rest);
}
