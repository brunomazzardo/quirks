import { readFile } from "node:fs/promises";
import path from "node:path";

export interface PressureScenario {
  id: string;
  prompt: string;
  forbidden_actions: string[];
  required_cli_invocations: string[];
  observedViolation: string;
  skillGuards: string[];
}

export interface PressureEvaluation {
  observedViolation: string;
  skillWouldForbid: boolean;
  skillBlocks: boolean;
}

function repositoryRoot(): string {
  return path.resolve(import.meta.dirname, "../../..");
}

export async function loadPressureScenarios(skillId: string): Promise<PressureScenario[]> {
  const fixturePath = path.join(repositoryRoot(), "test/skills/pressure", `${skillId}.jsonl`);
  const raw = await readFile(fixturePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as PressureScenario);
}

async function loadSkillMarkdown(skillId: string): Promise<string> {
  const skillPath = path.join(repositoryRoot(), "skills", skillId, "SKILL.md");
  return readFile(skillPath, "utf8");
}

function skillGuardsSatisfied(skillText: string, guards: string[]): boolean {
  const normalized = skillText.toLowerCase();
  return guards.every((guard) => normalized.includes(guard.toLowerCase()));
}

export async function evaluatePressureScenario(
  skillId: string,
  scenarioId: string,
  options: { loadSkill?: boolean } = {},
): Promise<PressureEvaluation> {
  const scenarios = await loadPressureScenarios(skillId);
  const scenario = scenarios.find((entry) => entry.id === scenarioId);
  if (!scenario) {
    throw new Error(`Unknown pressure scenario ${scenarioId} for skill ${skillId}`);
  }

  const skillText = options.loadSkill === false ? "" : await loadSkillMarkdown(skillId);
  const skillWouldForbid = skillGuardsSatisfied(skillText, scenario.skillGuards);
  const skillBlocks = skillGuardsSatisfied(skillText, scenario.skillGuards);

  return {
    observedViolation: scenario.observedViolation,
    skillWouldForbid,
    skillBlocks,
  };
}
