import { useRef, useState } from "react";
import type { RenderedPrompt, UiPromptSetV1 } from "../../../prompt/types.js";
import { PromptPreview } from "./prompt-preview.js";

/** Minimal clipboard capability; defaults to the browser Clipboard API. */
export interface ClipboardPort {
  writeText(text: string): Promise<void>;
}

export function recommendedPrompt(promptSet: UiPromptSetV1): RenderedPrompt | undefined {
  return (
    promptSet.recipes.find((recipe) => recipe.recipeId === promptSet.recommendedRecipeId) ??
    promptSet.recipes[0]
  );
}

export function alternativePrompts(promptSet: UiPromptSetV1): RenderedPrompt[] {
  const primary = recommendedPrompt(promptSet);
  return promptSet.recipes.filter((recipe) => recipe.recipeId !== primary?.recipeId);
}

/**
 * Copy prompt text through the provided clipboard capability. Never throws:
 * failure means the caller must reveal a selectable fallback instead.
 */
export async function copyPromptText(
  clipboard: ClipboardPort | undefined,
  text: string,
): Promise<{ ok: boolean }> {
  if (!clipboard) return { ok: false };
  try {
    await clipboard.writeText(text);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function defaultClipboard(): ClipboardPort | undefined {
  if (typeof navigator === "undefined" || !navigator.clipboard) return undefined;
  return navigator.clipboard;
}

export interface PromptActionsProps {
  promptSet: UiPromptSetV1;
  clipboard?: ClipboardPort;
  /** Test/deep-link hook: start with the clipboard fallback revealed. */
  initialFallbackText?: string;
}

/**
 * Contextual copy actions for one prompt set: an immediate primary copy
 * button, a More prompts menu of state-valid alternatives, previews, and a
 * selectable fallback when the Clipboard API fails. Only presentation state
 * lives here; prompt text is a disposable server projection.
 */
export function PromptActions({ promptSet, clipboard, initialFallbackText }: PromptActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewRecipeId, setPreviewRecipeId] = useState<string | null>(null);
  const [copiedRecipeId, setCopiedRecipeId] = useState<string | null>(null);
  const [fallbackText, setFallbackText] = useState<string | null>(initialFallbackText ?? null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const primary = recommendedPrompt(promptSet);
  if (!primary) return null;
  const alternatives = alternativePrompts(promptSet);
  const preview = promptSet.recipes.find((recipe) => recipe.recipeId === previewRecipeId);

  const copyNow = async (recipe: RenderedPrompt) => {
    const result = await copyPromptText(clipboard ?? defaultClipboard(), recipe.prompt);
    if (result.ok) {
      setFallbackText(null);
      setCopiedRecipeId(recipe.recipeId);
      if (copyResetTimer.current !== undefined) clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => setCopiedRecipeId(null), 2_000);
    } else {
      setCopiedRecipeId(null);
      setFallbackText(recipe.prompt);
    }
  };

  return (
    <div className="prompt-actions">
      <p className="prompt-actions-buttons">
        <button type="button" onClick={() => void copyNow(primary)}>
          {primary.label}
        </button>
        {copiedRecipeId !== null ? <span role="status">Copied</span> : null}
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          More prompts
        </button>
      </p>
      {primary.warnings.length > 0 ? (
        <ul role="note" className="prompt-actions-warnings">
          {primary.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {menuOpen ? (
        <ul role="menu" aria-label="More prompts" className="prompt-actions-menu">
          {[primary, ...alternatives].map((recipe) => (
            <li key={recipe.recipeId} role="presentation">
              <button type="button" role="menuitem" onClick={() => void copyNow(recipe)}>
                {recipe.label}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setPreviewRecipeId(recipe.recipeId);
                  setMenuOpen(false);
                }}
              >
                Preview {recipe.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {preview ? (
        <PromptPreview
          prompt={preview}
          onCopy={() => void copyNow(preview)}
          onClose={() => setPreviewRecipeId(null)}
        />
      ) : null}
      {fallbackText !== null ? (
        <div className="prompt-actions-fallback">
          <p role="alert">Copy failed or the clipboard is unavailable. Select the prompt text below.</p>
          <textarea
            readOnly
            aria-label="Prompt text"
            value={fallbackText}
            rows={12}
            ref={(element) => element?.select()}
          />
        </div>
      ) : null}
    </div>
  );
}
