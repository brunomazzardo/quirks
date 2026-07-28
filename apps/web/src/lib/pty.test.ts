// The pure parts of the pty client (QK-WB-004): where the socket points, and
// the once-only session guard that keeps StrictMode from spawning two shells.

import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { ensureSession, forgetSession, ptySocketUrl, resetSessionCache } from "./pty";

const ORIGIN = "http://localhost:5733";

beforeEach(() => {
  resetSessionCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---- ptySocketUrl ----

it("points at the page's own origin by default — the same-origin rule the rest of the app follows", () => {
  expect(ptySocketUrl("pty_abc", ORIGIN, "")).toBe(
    "ws://localhost:5733/v1/pty/sessions/pty_abc/socket",
  );
});

it("follows an explicit base when one is configured", () => {
  expect(ptySocketUrl("pty_abc", ORIGIN, "http://127.0.0.1:47301")).toBe(
    "ws://127.0.0.1:47301/v1/pty/sessions/pty_abc/socket",
  );
});

it("upgrades the scheme with the page: an https page must not open a ws: socket", () => {
  // Mixed content is refused by the browser, and the failure is indistinguishable
  // from a daemon that is down — so the scheme has to track the origin.
  expect(ptySocketUrl("pty_abc", "https://example.test", "")).toBe(
    "wss://example.test/v1/pty/sessions/pty_abc/socket",
  );
  expect(ptySocketUrl("pty_abc", ORIGIN, "https://example.test")).toBe(
    "wss://example.test/v1/pty/sessions/pty_abc/socket",
  );
});

it("escapes the session id rather than pasting it into a path", () => {
  expect(ptySocketUrl("a/../b", ORIGIN, "")).toContain("a%2F..%2Fb");
});

// ---- ensureSession ----

it("creates a session once per tab, however many times the effect runs", async () => {
  const create = vi.fn(async () => ({ id: "pty_one" }) as never);

  // React StrictMode runs every effect twice in development. Two shells per
  // click, one of them leaked, is a bug that never shows up in a production
  // build — which is exactly why it is pinned here.
  const [first, second] = await Promise.all([
    ensureSession("term-1", create),
    ensureSession("term-1", create),
  ]);

  expect(create).toHaveBeenCalledTimes(1);
  expect(first).toBe(second);
});

it("keeps different tabs on different sessions", async () => {
  const create = vi
    .fn()
    .mockResolvedValueOnce({ id: "pty_one" })
    .mockResolvedValueOnce({ id: "pty_two" });

  const first = await ensureSession("term-1", create as never);
  const second = await ensureSession("term-2", create as never);

  expect(create).toHaveBeenCalledTimes(2);
  expect(first).not.toBe(second);
});

it("does not cache a failure, so Retry can still succeed", async () => {
  const create = vi
    .fn()
    .mockRejectedValueOnce(new Error("daemon unreachable"))
    .mockResolvedValueOnce({ id: "pty_ok" });

  await expect(ensureSession("term-1", create as never)).rejects.toThrow("daemon unreachable");
  await expect(ensureSession("term-1", create as never)).resolves.toEqual({ id: "pty_ok" });
  expect(create).toHaveBeenCalledTimes(2);
});

it("forgetting a tab lets the next one create its own session", async () => {
  const create = vi
    .fn()
    .mockResolvedValueOnce({ id: "pty_one" })
    .mockResolvedValueOnce({ id: "pty_two" });

  expect(await ensureSession("term-1", create as never)).toEqual({ id: "pty_one" });
  forgetSession("term-1");
  expect(await ensureSession("term-1", create as never)).toEqual({ id: "pty_two" });
});
