import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPlanProgressProjection } from "../../../src/ui/read-models/plan-progress.js";
import { PlanProgressLedger, PlanProgressUnavailable } from "../../../src/ui/client/components/plan-progress-ledger.js";
import { FIXTURE_PLAN_PATH, fixtureWithReportedCompletion } from "../support/plan-progress-fixture.js";

test("renders worker-reported completion without controller reviewed label", () => {
  const result = buildPlanProgressProjection(fixtureWithReportedCompletion());
  assert.equal(result.available, true);
  if (!result.available) return;
  const html = renderToStaticMarkup(<PlanProgressLedger projection={result.projection} />);
  assert.match(html, /Worker reported/);
  assert.doesNotMatch(html, /Controller reviewed/);
  assert.match(html, /Completion authority: controller/);
});

test("renders only journal-derived plan content", () => {
  const result = buildPlanProgressProjection(fixtureWithReportedCompletion());
  assert.equal(result.available, true);
  if (!result.available) return;
  const html = renderToStaticMarkup(<PlanProgressLedger projection={result.projection} />);
  // Everything shown derives from the fixture journal event.
  assert.match(html, new RegExp(FIXTURE_PLAN_PATH.replaceAll("/", "\\/").replaceAll(".", "\\.")));
  assert.match(html, /Plan task 14 · step 3/);
  // The formerly fabricated constants never render.
  assert.doesNotMatch(html, /Campaign supervisor orchestration/);
  assert.doesNotMatch(html, /2026-07-21-quirks-campaign-control-plane/);
  assert.doesNotMatch(html, new RegExp("a".repeat(40)));
});

test("renders an explicit unavailable state without fabricated plan content", () => {
  const html = renderToStaticMarkup(<PlanProgressUnavailable />);
  assert.match(html, /Plan progress/);
  assert.match(html, /No plan progress recorded for this campaign\./);
  assert.doesNotMatch(html, /Campaign supervisor orchestration/);
});
