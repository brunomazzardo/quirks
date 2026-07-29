// One sentence for "the daemon read did not work" (lifted out of
// ledger-pane.tsx when QK-WB-007 added a second reader that needs the same
// vocabulary).
//
// It keeps the reason rather than flattening it: the difference between a
// stopped daemon (proxy 5xx) and a run that does not exist (404) is the whole
// of what the reader can do next.

import * as Cause from "effect/Cause";

export function describeCause(cause: Cause.Cause<Error>, fallback = "the request failed"): string {
  const error = Cause.squash(cause);
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return fallback;
}
