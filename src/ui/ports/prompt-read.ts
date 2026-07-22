import type { PromptContext, PromptContextKind } from "../../prompt/types.js";

export interface PromptReadRequest {
  contextKind: PromptContextKind;
  campaignId?: string;
  taskId?: string;
}

/**
 * Authority adapter that assembles a bounded {@link PromptContext} for one
 * request through existing read models and ports. It never opens canonical
 * task files or credentials directly; missing data stays missing.
 */
export interface PromptReadPort {
  getContext(request: PromptReadRequest): Promise<PromptContext>;
}
