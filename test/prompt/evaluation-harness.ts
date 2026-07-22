import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { getRecipe } from "../../src/prompt/catalog.js";
import { renderPrompt } from "../../src/prompt/render.js";
import type { PromptAction, PromptContext } from "../../src/prompt/types.js";
import { approvedCampaignPromptContext, reviewPromptContext } from "../ui/support/fake-prompts.js";

function runDevelopmentRunner(command: string, scenarioId: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [scenarioId], { stdio: ["pipe", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Evaluation runner exited with code ${code} for ${scenarioId}`));
    });
    child.stdin.end(prompt);
  });
}

/**
 * Development-only fresh-agent prompt evaluations. The default test run
 * scores the stored example results in the JSONL fixtures — no network and
 * no model call. Setting QUIRKS_PROMPT_EVAL_RUNNER to an executable enables
 * the opt-in development mode that feeds each generated prompt to a fresh
 * agent process on stdin and scores its stdout.
 */

export interface PromptEvaluationScenario {
  id: string;
  recipeId: PromptAction;
  /** Named deterministic context fixture used to generate the prompt. */
  fixture: "review" | "adversarial-review" | "approved-campaign";
  /** Facts a compliant result must contain (exact task/plan/commit/skill/verification references). */
  requiredObservations: string[];
  /** Behaviors a compliant result must not contain (scope or authority violations). */
  forbiddenActions: string[];
  /** Stored transcript scored by the default no-network run. */
  exampleResult: string;
  expectedPass: boolean;
}

export interface PromptEvaluationScore {
  scenarioId: string;
  missingObservations: string[];
  violations: string[];
  pass: boolean;
}

export function evaluationContext(fixture: PromptEvaluationScenario["fixture"]): PromptContext {
  switch (fixture) {
    case "review":
    case "adversarial-review":
      return reviewPromptContext();
    case "approved-campaign":
      return approvedCampaignPromptContext();
  }
}

export function generateScenarioPrompt(scenario: PromptEvaluationScenario): string {
  const recipe = getRecipe(scenario.recipeId);
  if (!recipe) throw new Error(`Unknown recipe ${scenario.recipeId}`);
  return renderPrompt(recipe, evaluationContext(scenario.fixture)).prompt;
}

export function scoreEvaluationResult(
  scenario: PromptEvaluationScenario,
  transcript: string,
): PromptEvaluationScore {
  const missingObservations = scenario.requiredObservations.filter(
    (observation) => !transcript.includes(observation),
  );
  const violations = scenario.forbiddenActions.filter((action) => transcript.includes(action));
  return {
    scenarioId: scenario.id,
    missingObservations,
    violations,
    pass: missingObservations.length === 0 && violations.length === 0,
  };
}

export async function loadEvaluationScenarios(): Promise<PromptEvaluationScenario[]> {
  const fixturePath = path.resolve("test/prompt/evaluations/contextual-prompts.jsonl");
  const raw = await readFile(fixturePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as PromptEvaluationScenario);
}

test("evaluation scenarios generate valid prompts and score stored results deterministically", async () => {
  const scenarios = await loadEvaluationScenarios();
  assert.ok(scenarios.length >= 3, "expected bounded scenario coverage");
  for (const scenario of scenarios) {
    const prompt = generateScenarioPrompt(scenario);
    assert.ok(prompt.length > 0, scenario.id);
    for (const observation of scenario.requiredObservations) {
      assert.ok(observation.length > 0, `${scenario.id} has empty observation`);
    }
    const score = scoreEvaluationResult(scenario, scenario.exampleResult);
    assert.equal(
      score.pass,
      scenario.expectedPass,
      `${scenario.id}: expected pass=${scenario.expectedPass}, missing=${score.missingObservations.join("|")}, violations=${score.violations.join("|")}`,
    );
  }
});

test("scoring rejects transcripts that skip authority or break scope", async () => {
  const scenarios = await loadEvaluationScenarios();
  const scenario = scenarios.find((entry) => entry.expectedPass);
  assert.ok(scenario);
  const offTask = scoreEvaluationResult(scenario, "I did some stuff and it looked fine.");
  assert.equal(offTask.pass, false);
  assert.ok(offTask.missingObservations.length > 0);

  const scopeBreaker = scoreEvaluationResult(scenario, [
    ...scenario.requiredObservations,
    ...scenario.forbiddenActions,
  ].join("\n"));
  assert.equal(scopeBreaker.pass, false);
  assert.ok(scopeBreaker.violations.length > 0);
});

const evalRunner = process.env["QUIRKS_PROMPT_EVAL_RUNNER"];

test(
  "development runner evaluation (opt-in via QUIRKS_PROMPT_EVAL_RUNNER)",
  { skip: !evalRunner },
  async () => {
    const scenarios = await loadEvaluationScenarios();
    for (const scenario of scenarios.filter((entry) => entry.expectedPass)) {
      const prompt = generateScenarioPrompt(scenario);
      const stdout = await runDevelopmentRunner(evalRunner!, scenario.id, prompt);
      const score = scoreEvaluationResult(scenario, stdout);
      assert.equal(
        score.pass,
        true,
        `${scenario.id}: missing=${score.missingObservations.join("|")}, violations=${score.violations.join("|")}`,
      );
    }
  },
);
