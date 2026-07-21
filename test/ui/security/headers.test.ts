import assert from "node:assert/strict";
import test from "node:test";
import { contentSecurityPolicy, applySecurityHeaders } from "../../../src/ui/security/headers.js";
import { createResponseNonce } from "../../../src/ui/security/nonce.js";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

test("sets no-store, nosniff, CORP, COOP, referrer, and nonce CSP", () => {
  const nonce = createResponseNonce();
  const res = new ServerResponse(new IncomingMessage(new Socket()));
  const headers: Record<string, string | string[]> = {};
  res.setHeader = (k: string, v: string | string[]) => { headers[k.toLowerCase()] = v; return res; };
  applySecurityHeaders(res, { nonce });
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["content-security-policy"], contentSecurityPolicy(nonce));
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["cross-origin-resource-policy"], "same-origin");
  assert.equal(headers["cross-origin-opener-policy"], "same-origin");
});

test("creates distinct nonces per response", () => {
  const first = createResponseNonce();
  const second = createResponseNonce();
  assert.notEqual(first, second);
});
