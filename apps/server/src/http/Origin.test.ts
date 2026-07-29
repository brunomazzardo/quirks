// The same-origin guard (http/Wire.ts `originGuard`).
//
// The case that earns this file: `POST /v1/pty/sessions` takes `shell`/`args`
// from the caller, `request.json` parses a body whatever its content type says,
// and the daemon's port is a hash of the repo root inside a 15,000-wide range.
// A page on any website could therefore spray fire-and-forget POSTs until one
// landed and run a command on the operator's machine — never reading a byte of
// the response, which is why "no CORS headers" was never the protection it read
// as. `exec_shell_from_a_hostile_page` below is that exploit, verbatim.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { makeWebHandler } from "../App.ts";
import { tempRoot } from "../testing/Harness.ts";

const disposers: Array<() => Promise<void>> = [];

function appFor(root = tempRoot("quirks-origin-")) {
  const { handler, dispose } = makeWebHandler({ root });
  disposers.push(dispose);
  const url = (path: string) => new URL(path, "http://127.0.0.1").toString();
  /** `host` is what the request was addressed to; `origin` is who sent it. The
   *  real server reads both off the wire — a constructed Request must say so. */
  const send = (method: string, path: string, origin?: string, body?: unknown) =>
    handler(
      new Request(url(path), {
        method,
        headers: {
          host: "127.0.0.1",
          ...(origin === undefined ? {} : { origin }),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return { root, send, handler };
}

afterAll(async () => {
  for (const dispose of disposers) await dispose();
});

describe("the same-origin guard", () => {
  it("refuses a hostile page trying to spawn a shell, and spawns nothing", async () => {
    const app = appFor();
    const marker = join(app.root, "PWNED.txt");
    rmSync(marker, { force: true });

    const attack = await app.send("POST", "/v1/pty/sessions", "https://evil.example", {
      shell: "/bin/sh",
      args: ["-c", `echo owned > ${marker}; exit 0`],
      cols: 80,
      rows: 24,
    });

    expect(attack.status).toBe(403);
    expect((await attack.json()).error).toContain("cross-origin");

    // The side effect IS the attack — a refusal that still spawned would be no
    // refusal at all. Nothing ran, and no session exists to have run it.
    expect(existsSync(marker)).toBe(false);
    const listed = await app.send("GET", "/v1/pty/sessions");
    expect((await listed.json()).sessions).toEqual([]);
  });

  it("refuses every state-changing verb from another origin", async () => {
    const app = appFor();
    const evil = "https://evil.example";
    for (const path of [
      "/v1/goals",
      "/v1/tasks",
      "/v1/runs",
      "/v1/shape/ensure",
      "/v1/shape/screens",
      "/shape/event",
    ]) {
      const response = await app.send("POST", path, evil, {});
      expect({ path, status: response.status }).toEqual({ path, status: 403 });
    }
  });

  it("refuses the opaque origin a sandboxed frame sends", async () => {
    const app = appFor();
    const response = await app.send("POST", "/v1/goals", "null", {
      id: "QK-NUL",
      title: "t",
      why: "w",
      doneWhen: ["x"],
    });
    expect(response.status).toBe(403);
  });

  it("lets the workbench through — it is the same origin", async () => {
    const app = appFor();
    const response = await app.send("POST", "/v1/goals", "http://127.0.0.1", {
      id: "QK-SAME",
      title: "same origin",
      why: "the workbench is served from this very host",
      doneWhen: ["it works"],
    });
    expect(response.status).toBe(201);
  });

  it("lets the CLI through — no Origin is a caller no page can drive", async () => {
    const app = appFor();
    const response = await app.send("POST", "/v1/goals", undefined, {
      id: "QK-CLI",
      title: "cli",
      why: "curl and the CLI send no Origin",
      doneWhen: ["it works"],
    });
    expect(response.status).toBe(201);
  });

  it("still serves cross-origin reads — they change nothing and cannot be read", async () => {
    const app = appFor();
    const response = await app.send("GET", "/v1/goals", "https://evil.example");
    expect(response.status).toBe(200);
  });

  it("refuses a cross-origin WebSocket upgrade — a GET that carries writes", async () => {
    // The socket's `input` and `resize` frames go straight to the shell, and a
    // WebSocket obeys neither the same-origin policy nor preflight. Keying the
    // guard off the HTTP verb alone left the exec surface open through the one
    // door that does not look like a write.
    const app = appFor();
    const response = await app.handler(
      new Request("http://127.0.0.1/v1/pty/sessions/pty_x/socket", {
        headers: {
          host: "127.0.0.1",
          origin: "https://evil.example",
          upgrade: "websocket",
          connection: "Upgrade",
        },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("lets the dev proxy through — it rewrites Host, so Host is not the boundary", async () => {
    // apps/web's Vite proxy sets `changeOrigin: true`: Host becomes the daemon
    // while Origin stays the dev server. Comparing the two would 403 every
    // write in `pnpm dev` — the one topology the project develops in.
    const app = appFor();
    const response = await app.send("POST", "/v1/goals", "http://localhost:5733", {
      id: "QK-DEV",
      title: "dev proxy",
      why: "the dev server is a loopback origin",
      doneWhen: ["it works"],
    });
    expect(response.status).toBe(201);
  });
});
