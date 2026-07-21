import assert from "node:assert/strict";
import test from "node:test";
import { validateSchema } from "../../src/schema/validate.js";
import { campaignEnvelope } from "./support.js";

test("accepts a v1 campaign envelope and rejects unknown fields", () => {
  const envelope = campaignEnvelope();
  assert.equal(validateSchema("campaign-v1", envelope), envelope);
  assert.throws(() => validateSchema("campaign-v1", { ...envelope, surprise: true }), /must NOT have additional properties/);
});

test("accepts lifecycle states from the approved machine", () => {
  const snapshot = { schemaVersion: 1, campaignId: "cmp-1", status: "awaiting_approval", digest: "sha256:digest", updatedAt: "2026-07-21T16:00:01.000Z" };
  assert.equal(validateSchema("campaign-state-v1", snapshot), snapshot);
  assert.throws(() => validateSchema("campaign-state-v1", { ...snapshot, status: "exploding" }), /status/);
});
