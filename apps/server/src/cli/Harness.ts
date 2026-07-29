// quirks harness — "can tonight's run lean on codex?" without reading a doc.
// Two views (D7): harness availability, and the tier → model table.
// A read: table on a TTY, JSON when piped or given --json.
//
// The row/tier/review shapes are the CONTRACT's (packages/contracts/src/wire.ts).
// They were declared here for a while because that file typed `GET /v1/harness`
// as `unknown`; it no longer does, so the wire shape of a served route is not
// defined in a rendering layer the web cannot see.

import * as Effect from "effect/Effect";
import type { HarnessRow, HarnessViewResponse } from "@quirks/contracts";
import { request, type ServiceError } from "./Client.ts";
import { emitRead, table } from "./Output.ts";

export type HarnessView = HarnessViewResponse;

const LEAN_MARK: Readonly<Record<HarnessRow["lean"], string>> = {
  yes: "yes",
  no: "NO",
  unproven: "unproven",
};

const AUTH_MARK: Readonly<Record<string, string>> = {
  authorized: "yes",
  unauthorized: "NO",
  unknown: "?",
  "not-probed": "not probed",
};

function renderHarnesses(view: HarnessView): string {
  const rows = view.harnesses.map((h) => [
    h.runner,
    LEAN_MARK[h.lean],
    h.presence === "present" ? "yes" : h.presence,
    AUTH_MARK[h.authorized] ?? h.authorized,
    h.version ?? (view.probed ? "—" : "not probed"),
    h.livenessDetail,
  ]);
  return table(["harness", "lean on it?", "present", "authed", "version", "last dispatch"], rows);
}

/** Why each answer, for the ones that are not a plain yes. */
function renderCaveats(view: HarnessView): string {
  const lines = view.harnesses
    .filter((h) => h.lean !== "yes")
    .map((h) => `  ${h.runner}: ${h.leanDetail}`);
  return lines.length === 0 ? "" : `\n${lines.join("\n")}`;
}

function renderTiers(view: HarnessView): string {
  const runners = Object.keys(view.tiers[0]?.runners ?? {});
  const rows = view.tiers.map((t) => [
    t.tier,
    ...runners.map((r) => {
      const cell = t.runners[r];
      if (!cell || cell.model === null) return "—";
      return cell.effort ? `${cell.model} / ${cell.effort}` : cell.model;
    }),
  ]);
  return table(["tier", ...runners], rows);
}

function renderReview(view: HarnessView): string {
  const rows = view.review.map((r) =>
    r.selection.kind === "independent"
      ? [
          r.tier,
          r.selection.reviewer.tier,
          `${r.selection.reviewer.runner}/${r.selection.reviewer.model}`,
        ]
      : [r.tier, r.selection.requiredTier, "NONE — review cannot be independent"],
  );
  return table(["implementer tier", "reviewer tier", "independent reviewer"], rows);
}

export function renderHarnessView(view: HarnessView): string {
  const header = view.probed
    ? "probed --version against each present harness"
    : "presence + run record only — pass --probe to run --version";
  const availability = view.available.length > 0 ? view.available.join(", ") : "none";
  return [
    `harnesses (${header})`,
    "",
    renderHarnesses(view),
    renderCaveats(view),
    "",
    `available for a run now: ${availability}`,
    "",
    "tier → model / effort",
    "",
    renderTiers(view),
    "",
    "independent review (assuming a claude implementer)",
    "",
    renderReview(view),
    "",
    `"—" is a tier with no probed model. Liveness is the newest recorded dispatch,`,
    `not a live call; ${view.probed ? "--probe ran" : "--probe"} for a real round trip.`,
  ].join("\n");
}

export const harnessShow = (opts: {
  json: boolean;
  probe: boolean;
}): Effect.Effect<void, ServiceError> =>
  Effect.gen(function* () {
    const query = opts.probe ? "?probe=true" : "";
    const view: HarnessView = yield* request("GET", `/v1/harness${query}`);
    yield* emitRead(view, opts.json, () => renderHarnessView(view));
  });
