// Small pieces both run views wear (QK-WB-007), kept in one file so the list
// and the report cannot drift into two vocabularies for the same fact.
//
// The palette is QK-WB-006's and its rule is unchanged: colour is meaning,
// never decoration. Moss is passing or live, ember is failing, the lamp marks
// the one thing under attention, and everything else stays muted. A run list
// where every row carried a hue would say nothing at all.

import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import type { RunTone } from "~/lib/runs";

/** The text colour a run's status word is allowed to take. */
export function toneClass(tone: RunTone): string {
  if (tone === "attention") return "text-ember";
  if (tone === "live" || tone === "clean") return "text-moss";
  return "text-muted-foreground";
}

/**
 * The live mark: a moss dot that breathes.
 *
 * It is the workbench's only looping animation — everything else is a
 * one-shot transition bridging a state change — and it earns that by answering
 * the one question a polling view owes its reader — "is this still moving, or
 * is it just an old page?". It stops the moment the run reaches a terminal
 * status, because at that point the honest answer changes.
 */
export function LivePulse({ label = "live", className }: { label?: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 font-mono text-[10px] text-moss", className)}
      title="polling this run — the record updates as the runner writes it"
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-moss motion-safe:animate-pulse"
      />
      {label}
    </span>
  );
}

/** A labelled mono figure — the density-A row's unit of fact. */
export function Stat({
  label,
  value,
  className,
  title,
}: {
  label: string;
  value: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5 font-mono text-[10px]" title={title}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", className)}>{value}</span>
    </span>
  );
}

/**
 * A runner's own words, shown as a quote and never as prose.
 *
 * This is the honesty property with a border around it. `evidenceQuote` is the
 * same bytes checked against the retained transcript (D14: "the report never
 * paraphrases a verdict"), and a dispatch's `failureMessage` is the runner's
 * own complaint, dated. So: monospace, a rule down the side, real quotation
 * marks, `whitespace-pre-wrap` so the runner's own line breaks survive, and NO
 * truncation — a long refusal wraps and stays whole rather than ending in an
 * ellipsis that hides the part you needed.
 *
 * `tone` says whose failure it is, not how loud to be: ember when the quote
 * belongs to something that went wrong, the lamp when it is the evidence
 * behind a verdict that stood.
 */
export function Quote({
  text,
  source,
  tone = "ember",
}: {
  text: string;
  source: string;
  tone?: "ember" | "lamp";
}) {
  return (
    <figure className="my-1.5">
      <blockquote
        className={cn(
          "border-l-2 py-0.5 pl-3 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap",
          tone === "ember" ? "border-l-ember text-foreground" : "border-l-lamp text-foreground",
        )}
      >
        <span aria-hidden="true" className="pr-0.5 text-muted-foreground select-none">
          &ldquo;
        </span>
        {text}
        <span aria-hidden="true" className="pl-0.5 text-muted-foreground select-none">
          &rdquo;
        </span>
      </blockquote>
      <figcaption className="pt-1 pl-3 font-mono text-[10px] text-muted-foreground">
        {source}
      </figcaption>
    </figure>
  );
}

/** Quiet, honest nothing. Used for an empty ledger and an empty section alike. */
export function EmptyState({ headline, detail }: { headline: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-16 text-center">
      <p className="font-mono text-xs text-muted-foreground">{headline}</p>
      {detail !== undefined && (
        <p className="max-w-md font-mono text-[10px] text-muted-foreground/70">{detail}</p>
      )}
    </div>
  );
}
