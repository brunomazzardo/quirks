import assert from "node:assert/strict";
import test from "node:test";

const APPROVED = process.env.QUIRKS_SMOKE_APPROVED === "approve-paid-runner-probes";

test("claude host runner smoke matrix", { skip: !APPROVED }, async () => {
  assert.fail("real Claude host/runner smoke requires local credentials and manual approval");
});

test("claude host runner smoke blocked without approval gate", { skip: APPROVED }, () => {
  assert.equal(process.env.QUIRKS_SMOKE_APPROVED ?? "", "");
});
