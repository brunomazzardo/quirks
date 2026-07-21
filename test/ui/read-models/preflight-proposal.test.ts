import assert from "node:assert/strict";
import test from "node:test";
import { buildPreflightResponse } from "../../../src/ui/read-models/preflight-proposal.js";
import { validateSchema } from "../../../src/schema/validate.js";
import { fakePreflightPort } from "../support/fake-preflight.js";

test("returns proposal derived from port without HTML persistence fields", async () => {
  const port = fakePreflightPort();
  const proposal = await buildPreflightResponse(port, "C-1");
  assert.equal(proposal.campaignId, "C-1");
  assert.equal(proposal.approval.envelopeDigest, proposal.envelopeDigest);
  assert.equal((proposal as { html?: string }).html, undefined);
  validateSchema("ui-preflight-proposal-v1", proposal);
});
