// The shape companion page's content policy.
//
// A screen that looks like a full document is served verbatim, on the very
// origin that serves /v1 — so the page names what it may do rather than
// trusting every screen ever written. The injected helper runs by nonce; a
// screen's own executable script does not.

import { afterAll, describe, expect, it } from "vite-plus/test";
import { makeWebHandler } from "../App.ts";
import { tempRoot } from "../testing/Harness.ts";

const disposers: Array<() => Promise<void>> = [];

function appFor() {
  const { handler, dispose } = makeWebHandler({ root: tempRoot("quirks-shape-") });
  disposers.push(dispose);
  const url = (path: string) => new URL(path, "http://127.0.0.1").toString();
  return {
    get: (path: string) => handler(new Request(url(path), { headers: { host: "127.0.0.1" } })),
    push: (name: string, html: string) =>
      handler(
        new Request(url("/v1/shape/screens"), {
          method: "POST",
          headers: { host: "127.0.0.1", "content-type": "application/json" },
          body: JSON.stringify({ name, html }),
        }),
      ),
  };
}

/** The nonce the response's own CSP authorises. */
function nonceOf(csp: string | null): string {
  return csp?.match(/'nonce-([^']+)'/)?.[1] ?? "";
}

afterAll(async () => {
  for (const dispose of disposers) await dispose();
});

describe("the shape page", () => {
  it("authorises the injected helper and nothing else", async () => {
    const app = appFor();
    expect((await app.push("evil.html", "<h2>a screen</h2>")).status).toBe(201);

    const page = await app.get("/shape/");
    const csp = page.headers.get("content-security-policy");
    const nonce = nonceOf(csp);

    expect(nonce.length).toBeGreaterThan(0);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    // The helper is the one script that may run.
    expect(await page.text()).toContain(`<script nonce="${nonce}">`);
  });

  it("does not authorise a script a screen brought with it", async () => {
    const app = appFor();
    await app.push(
      "evil.html",
      "<!doctype html><html><body><script>fetch('/v1/goals')</script></body></html>",
    );

    const page = await app.get("/shape/");
    const body = await page.text();
    const nonce = nonceOf(page.headers.get("content-security-policy"));

    // The bytes are still served — this is the operator's own file, and
    // rewriting it would be a lie about what is on disk. What changes is that
    // the browser will not execute it: no nonce, and the policy allows no other
    // source of script.
    expect(body).toContain("fetch('/v1/goals')");
    expect(body).not.toContain(`<script nonce="${nonce}">fetch`);
  });

  it("mints a fresh nonce per response — a predictable one is not a nonce", async () => {
    const app = appFor();
    const first = nonceOf((await app.get("/shape/")).headers.get("content-security-policy"));
    const second = nonceOf((await app.get("/shape/")).headers.get("content-security-policy"));
    expect(first).not.toBe(second);
  });
});
