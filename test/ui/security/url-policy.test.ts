import assert from "node:assert/strict";
import test from "node:test";
import { classifyUrl } from "../../../src/ui/security/url-policy.js";

const authority = "http://127.0.0.1:38491";

test("accepts https remotes and exact loopback authority", () => {
  assert.equal(classifyUrl("https://github.com/org/repo/pull/1", authority).kind, "https");
  assert.equal(classifyUrl("http://127.0.0.1:38491/git/open?sha=abc", authority).kind, "loopback-http");
});

test("accepts internal application routes", () => {
  assert.deepEqual(classifyUrl("/git/compare?base=a&head=b", authority), {
    kind: "internal-route",
    route: "/git/compare?base=a&head=b",
  });
});

test("rejects javascript, data, and mismatched loopback hosts", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,hi", "http://localhost:1/x", "http://127.0.0.1:99999/x"]) {
    assert.equal(classifyUrl(href, authority).kind, "rejected", href);
  }
});
