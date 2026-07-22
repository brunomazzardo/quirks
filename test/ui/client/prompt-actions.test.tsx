import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  alternativePrompts,
  copyPromptText,
  PromptActions,
  recommendedPrompt,
  type ClipboardPort,
} from "../../../src/ui/client/components/prompt-actions.js";
import { PromptPreview } from "../../../src/ui/client/components/prompt-preview.js";
import { buildPromptSet } from "../../../src/ui/read-models/prompts.js";
import { reviewPromptContext } from "../support/fake-prompts.js";

function reviewPromptSet() {
  return buildPromptSet(reviewPromptContext());
}

function mockClipboard(options: { fail?: boolean } = {}) {
  const writes: string[] = [];
  const clipboard: ClipboardPort = {
    async writeText(text: string) {
      if (options.fail) throw new Error("clipboard unavailable");
      writes.push(text);
    },
  };
  return { clipboard, writes };
}

test("model selects the recommended prompt and state-valid alternatives", () => {
  const set = reviewPromptSet();
  const primary = recommendedPrompt(set);
  assert.equal(primary?.recipeId, "review-task-code");
  const alternatives = alternativePrompts(set);
  assert.equal(alternatives.some((recipe) => recipe.recipeId === "review-task-code"), false);
  assert.equal(alternatives.some((recipe) => recipe.recipeId === "adversarial-task-review"), true);
});

test("copyPromptText reports success and failure without throwing", async () => {
  const success = mockClipboard();
  assert.deepEqual(await copyPromptText(success.clipboard, "prompt body"), { ok: true });
  assert.deepEqual(success.writes, ["prompt body"]);

  const failure = mockClipboard({ fail: true });
  assert.deepEqual(await copyPromptText(failure.clipboard, "prompt body"), { ok: false });

  assert.deepEqual(await copyPromptText(undefined, "prompt body"), { ok: false });
});

test("renders one primary copy button and a More prompts menu button", () => {
  const set = reviewPromptSet();
  const html = renderToStaticMarkup(<PromptActions promptSet={set} />);
  assert.match(html, /Copy review prompt/);
  assert.match(html, /More prompts/);
  assert.doesNotMatch(html, /disabled/);
  assert.equal(html.includes(set.recipes[0]!.prompt), false, "prompt text is not rendered until preview");
});

test("preview exposes recipe version, target, bindings, warnings, and exact text", () => {
  const set = reviewPromptSet();
  const adversarial = set.recipes.find((recipe) => recipe.recipeId === "adversarial-task-review")!;
  const html = renderToStaticMarkup(
    <PromptPreview prompt={adversarial} onClose={() => {}} onCopy={() => {}} />,
  );
  assert.match(html, /adversarial-task-review/);
  assert.match(html, new RegExp(`v${adversarial.recipeVersion}`));
  assert.ok(html.includes("claude-opus"), "target profile is shown");
  assert.match(html, /Bindings/);
  assert.match(html, /QK-1/);
  assert.ok(html.includes(adversarial.prompt.slice(0, 40)), "exact prompt text is shown");
});

test("clipboard fallback renders a focused selectable textarea with the prompt", () => {
  const set = reviewPromptSet();
  const html = renderToStaticMarkup(
    <PromptActions promptSet={set} initialFallbackText={set.recipes[0]!.prompt} />,
  );
  assert.match(html, /<textarea[^>]*readonly/i);
  assert.match(html, /Copy failed/i);
});
