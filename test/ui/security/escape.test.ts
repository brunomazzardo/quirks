import assert from "node:assert/strict";
import test from "node:test";
import { escapeAttribute, escapeHtml } from "../../../src/ui/security/escape.js";

test("escapes HTML metacharacters", () => {
  assert.equal(escapeHtml(`<img src=x onerror=alert(1)>`), "&lt;img src=x onerror=alert(1)&gt;");
});

test("escapes attribute metacharacters including backticks", () => {
  assert.equal(escapeAttribute(`" onmouseover=alert(1) x="`), "&quot; onmouseover=alert(1) x=&quot;");
  assert.equal(escapeAttribute("`code`"), "&#96;code&#96;");
});
