import type { RenderedPrompt } from "../../../prompt/types.js";

export interface PromptPreviewProps {
  prompt: RenderedPrompt;
  onCopy: () => void;
  onClose: () => void;
}

/**
 * Preview dialog exposing the exact prompt and its projection metadata before
 * copying: recipe identity and version, target profile, authoritative
 * bindings, and visible warnings. Prompt text stays presentation state and
 * never enters router search, query keys, or persistent storage.
 */
export function PromptPreview({ prompt, onCopy, onClose }: PromptPreviewProps) {
  return (
    <dialog open className="prompt-preview" aria-labelledby="prompt-preview-heading">
      <h3 id="prompt-preview-heading">
        {prompt.label} ({prompt.recipeId} v{prompt.recipeVersion})
      </h3>
      <p>{prompt.description}</p>
      <p>
        <strong>Authority:</strong> {prompt.authority}
      </p>
      <p>
        <strong>Target:</strong>{" "}
        {prompt.target.profileId
          ? `${prompt.target.profileId} (${prompt.target.runnerKind ?? "unknown runner"}, ${prompt.target.model ?? "unknown model"})`
          : "No specific profile"}
        {prompt.target.independentFromProfileId
          ? ` — independent from ${prompt.target.independentFromProfileId}`
          : ""}
      </p>
      <div>
        <strong>Bindings</strong>
        {prompt.bindings.length === 0 ? (
          <p>No bindings.</p>
        ) : (
          <ul>
            {prompt.bindings.map((binding, index) => (
              <li key={`${binding.kind}:${binding.label}:${index}`}>
                {binding.label} ({binding.kind}): {binding.value}
              </li>
            ))}
          </ul>
        )}
      </div>
      {prompt.warnings.length > 0 ? (
        <div role="note">
          <strong>Warnings</strong>
          <ul>
            {prompt.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <pre className="prompt-preview-text">{prompt.prompt}</pre>
      <p className="prompt-preview-actions">
        <button type="button" onClick={onCopy}>
          Copy this prompt
        </button>
        <button type="button" onClick={onClose}>
          Close preview
        </button>
      </p>
    </dialog>
  );
}
