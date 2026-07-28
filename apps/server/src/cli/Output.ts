// What a verb prints, and the one rule that decides which form it takes.
//
// Reads render a table on a TTY and JSON when piped or given --json; writes
// always print the resulting object as JSON, because their consumer is a skill
// that wants the object back. Nothing here prompts.

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

/** A refusal the user caused: printed as `quirks: …`, exit 1, no stack. */
export class CliError extends Data.TaggedError("CliError")<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export const cliError = (detail: string): CliError => new CliError({ detail });

export const emitJson = (data: unknown): Effect.Effect<void> =>
  Effect.sync(() => {
    console.log(JSON.stringify(data, null, 2));
  });

export const emitText = (text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    console.log(text);
  });

export const warn = (text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    console.error(text);
  });

/** Is stdout a terminal? The single fact the read/write split turns on, read
 *  through one accessor so a test can state which world it is asserting. */
export const isTty = (): boolean => process.stdout.isTTY === true;

/** Reads render a table on a TTY; JSON when piped or asked for. Writes never
 *  call this — see the module comment. */
export const emitRead = (data: unknown, json: boolean, render: () => string): Effect.Effect<void> =>
  json || !isTty() ? emitJson(data) : emitText(render());

/** Column-aligned plain text. Trailing padding is trimmed so a copied line has
 *  no invisible tail, and a short row is padded rather than misaligned. */
export function table(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: readonly string[]): string =>
    headers
      .map((_, i) => (cells[i] ?? "").padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}
