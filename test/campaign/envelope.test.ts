import assert from "node:assert/strict";
import test from "node:test";
import { computeEnvelopeDigest, finalizeEnvelope, stripDigest } from "../../src/campaign/envelope.js";
import { campaignEnvelope } from "./support.js";

test("digest is stable across key order and excludes the digest field itself", () => {
  const input = stripDigest(campaignEnvelope());
  const digest = computeEnvelopeDigest(input);
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(computeEnvelopeDigest(stripDigest(finalizeEnvelope(input))), digest);
});
