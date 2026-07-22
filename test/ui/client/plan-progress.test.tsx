import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { fixtureWithReportedCompletion } from "../../../src/ui/api/plan-progress.js";
import { buildPlanProgressProjection } from "../../../src/ui/read-models/plan-progress.js";
import { PlanProgressLedger, PlanProgressUnavailable } from "../../../src/ui/client/components/plan-progress-ledger.js";

test("renders worker-reported completion without controller reviewed label", () => {
  const projection = buildPlanProgressProjection(fixtureWithReportedCompletion());
  const html = renderToStaticMarkup(<PlanProgressLedger projection={projection} />);
  assert.match(html, /Worker reported/);
  assert.doesNotMatch(html, /Controller reviewed/);
  assert.match(html, /Completion authority: controller/);
});

test("renders an explicit unavailable state without fabricated plan content", () => {
  const html = renderToStaticMarkup(<PlanProgressUnavailable />);
  assert.match(html, /Plan progress/);
  assert.match(html, /No plan progress recorded for this campaign\./);
  assert.doesNotMatch(html, /Campaign supervisor orchestration/);
});
