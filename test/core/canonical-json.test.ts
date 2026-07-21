import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../../src/core/canonical-json.js";
import { sha256 } from "../../src/core/hash.js";

test("canonical JSON sorts object keys recursively and preserves array order", () => {
  const value = { z: [{ b: 2, a: 1 }], a: true };
  assert.equal(canonicalJson(value), '{"a":true,"z":[{"a":1,"b":2}]}');
  assert.equal(sha256(value), "sha256:4f1cc1676b4591a84b76768886f93f659ac89c3c0ff933f4a0dccb6b2ceda86b");
});

test("canonical JSON rejects undefined and non-JSON numbers", () => {
  assert.throws(() => canonicalJson({ value: undefined }), { name: "QuirksError" });
  assert.throws(() => canonicalJson(Number.NaN), { name: "QuirksError" });
  assert.throws(() => canonicalJson(new Date(0)), { name: "QuirksError" });
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), { name: "QuirksError" });
});
