/**
 * The result-interpretation seam.
 *
 * The launcher knows how to start a vendor CLI correctly and nothing about the
 * shape of what it produces; an interpreter turns whatever the CLI actually
 * produced into the structured result Quirks needs. Keeping the two apart is
 * what lets the CLI speak naturally: the 2026-07-24 measurement was that
 * constraining codex's final message to an envelope removed its reasoning
 * entirely (0 prose messages with `--output-schema`, 8 without).
 */

export interface ReviewFinding {
  severity: "critical" | "important" | "minor" | "note";
  title: string;
  detail: string;
  file?: string;
  line?: number;
}
