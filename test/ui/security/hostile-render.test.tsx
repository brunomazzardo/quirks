import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CampaignDetailView } from "../../../src/ui/client/views/campaign-detail-view.js";
import { ExistingTasksView } from "../../../src/ui/client/views/existing-tasks-view.js";
import {
  PreflightProposalView,
} from "../../../src/ui/client/views/preflight-view.js";
import { TaskHistoryView } from "../../../src/ui/client/views/task-history-view.js";
import {
  hostileCampaignDetail,
  hostileExistingTasksProjection,
  hostilePreflightProposal,
  hostileTaskHistoryProjection,
  hostileText,
  hostileUrlVariants,
} from "../support/hostile-projections.js";

const activeMarkupPatterns = [
  /<script/i,
  /<\/script/i,
  /<img/i,
  /<[^>]+\sonerror=/i,
  /href="javascript:/i,
  /href="data:text\/html/i,
  /href="\/\/evil\.example/i,
  /href="https:\/\/user:pass@example\.com/i,
  /href="http:\/\/evil\.example/i,
];

function assertHostileTextIsEscaped(markup: string) {
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(markup, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  for (const pattern of activeMarkupPatterns) {
    assert.doesNotMatch(markup, pattern);
  }
}

test("Existing Tasks renders hostile projection text without active markup or unsafe links", () => {
  const markup = renderToStaticMarkup(
    <ExistingTasksView projection={hostileExistingTasksProjection()} />,
  );

  assertHostileTextIsEscaped(markup);
  for (const url of hostileUrlVariants) {
    assert.doesNotMatch(markup, new RegExp(`href="${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
});

test("Preflight renders hostile proposal fields as escaped text", () => {
  const markup = renderToStaticMarkup(
    <PreflightProposalView proposal={hostilePreflightProposal()} />,
  );

  assertHostileTextIsEscaped(markup);
  assert.match(markup, /safe/);
});

test("Campaign Detail renders hostile fields and rejects unsafe pull request URLs", () => {
  const markup = renderToStaticMarkup(<CampaignDetailView detail={hostileCampaignDetail()} />);

  assertHostileTextIsEscaped(markup);
  assert.equal((markup.match(/Unavailable/g) ?? []).length, hostileUrlVariants.length);
});

test("Task History renders hostile artifact data while keeping exact internal Git actions", () => {
  const markup = renderToStaticMarkup(
    <TaskHistoryView projection={hostileTaskHistoryProjection()} />,
  );

  assertHostileTextIsEscaped(markup);
  assert.match(markup, /href="\/git\/open\?path=src%2Fui%2Fclient%2Fviews%2Ftask-history-view\.tsx&amp;commit=207c92e"/);
  assert.match(markup, /href="\/git\/open\?path=src%2Fui%2Fclient%2Fviews%2Ftask-history-view\.tsx"/);
  assert.match(markup, /href="\/git\/compare\?path=src%2Fui%2Fclient%2Fviews%2Ftask-history-view\.tsx&amp;base=207c92e&amp;head=current"/);
  assert.match(markup, /href="https:\/\/example\.com\/provider\/path"/);
});
