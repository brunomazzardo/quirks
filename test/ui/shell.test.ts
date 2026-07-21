import assert from "node:assert/strict";
import test from "node:test";
import { contentSecurityPolicy } from "../../src/ui/security/headers.js";
import { renderShell } from "../../src/ui/shell.js";
import { createTestUiServer } from "./support/test-server.js";
import { rawLoopbackRequest } from "./support/raw-http.js";

test("shell contains no projection data and nonces its only script and style", () => {
  const html = renderShell({ nonce: "nonce-123", clientScript: "window.__QUIRKS_BOOT__=1;" });
  assert.doesNotMatch(html, /envelopeDigest|campaignId|application\/json/);
  assert.equal((html.match(/nonce="nonce-123"/g) ?? []).length, 2);
  assert.match(html, /<div id="app"><\/div>/);
});

const SHELL_GET_ROUTES = [
  "/",
  "/preflight/C-1",
  "/campaigns",
  "/campaigns/C-1",
  "/tasks/QK-1/history",
] as const;

const NEGATIVE_ROUTES = [
  { path: "/health", method: "GET", status: 404 },
  { path: "/_next/static/chunk.js", method: "GET", status: 404 },
  { path: "/assets/logo.png", method: "GET", status: 404 },
  { path: "/preflight/", method: "GET", status: 404 },
  { path: "/preflight/bad%20id", method: "GET", status: 404 },
  { path: "/preflight/C-1/extra", method: "GET", status: 404 },
  { path: "/campaigns/C-1/extra", method: "GET", status: 404 },
  { path: "/tasks/QK-1/history/extra", method: "GET", status: 404 },
  { path: "/tasks/bad%20id/history", method: "GET", status: 404 },
  { path: "/api/v1/existing-tasks", method: "GET", status: 401 },
] as const;

function assertSecurityHeaders(headers: Record<string, string | string[] | undefined>, nonce?: string) {
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["cross-origin-resource-policy"], "same-origin");
  assert.equal(headers["cross-origin-opener-policy"], "same-origin");
  if (nonce) {
    assert.equal(headers["content-security-policy"], contentSecurityPolicy(nonce));
  } else {
    assert.match(String(headers["content-security-policy"]), /script-src 'nonce-/);
  }
}

test("serves shell for validated GET routes with security headers", async () => {
  const server = await createTestUiServer({ clientScript: "window.__QUIRKS_BOOT__=1;" });
  try {
    for (const path of SHELL_GET_ROUTES) {
      const response = await rawLoopbackRequest({
        port: server.authority.port,
        path,
        headers: { Host: server.authority.hostHeader },
      });
      assert.equal(response.status, 200, path);
      assert.match(response.headers["content-type"] ?? "", /text\/html/);
      const nonce = String(response.headers["content-security-policy"]).match(/'nonce-([^']+)'/)?.[1];
      assert.ok(nonce, `missing nonce for ${path}`);
      assertSecurityHeaders(response.headers, nonce);
      assert.doesNotMatch(response.body, /envelopeDigest|campaignId|application\/json/);
      assert.match(response.body, /<div id="app"><\/div>/);
      assert.equal((response.body.match(new RegExp(`nonce="${nonce}"`, "g")) ?? []).length, 2);
    }
  } finally {
    await server.close();
  }
});

test("rejects non-GET shell routes and unknown paths with fixed status codes", async () => {
  const server = await createTestUiServer();
  try {
    for (const path of SHELL_GET_ROUTES) {
      for (const method of ["POST", "PUT", "DELETE"] as const) {
        const response = await rawLoopbackRequest({
          port: server.authority.port,
          path,
          method,
          headers: { Host: server.authority.hostHeader },
        });
        assert.equal(response.status, 405, `${method} ${path}`);
        assertSecurityHeaders(response.headers);
      }
    }
    for (const { path, method, status } of NEGATIVE_ROUTES) {
      const response = await rawLoopbackRequest({
        port: server.authority.port,
        path,
        method,
        headers: { Host: server.authority.hostHeader },
      });
      assert.equal(response.status, status, `${method} ${path}`);
      assertSecurityHeaders(response.headers);
    }
  } finally {
    await server.close();
  }
});
