// QK-COMP-003: shape companion on the quirks daemon — one session per repo,
// no session key, screens + events over loopback HTTP.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/service/app.ts";
import { stopContentWatch } from "../src/shape/session.ts";

function appFor(dir = mkdtempSync(join(tmpdir(), "quirks-shape-"))) {
  return { app: createApp({ root: dir, dir: join(dir, ".quirks") }), dir };
}

async function post(app: ReturnType<typeof createApp>, path: string, body?: unknown) {
  const init: RequestInit =
    body !== undefined
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : { method: "POST" };
  return app.request(path, init);
}

describe("shape companion routes", () => {
  test("ensure → waiting page → push screen → framed with helper → click → end", async () => {
    const { app, dir } = appFor();

    const ensure = await post(app, "/v1/shape/ensure");
    expect(ensure.status).toBe(200);
    const info = await ensure.json();
    expect(info.url).toContain("/shape/");
    expect(info.screen_dir).toContain("shape-sessions/current/content");
    expect(existsSync(join(info.state_dir, "server-info"))).toBe(true);

    const waiting = await app.request("/shape/");
    expect(waiting.status).toBe(200);
    const waitingHtml = await waiting.text();
    expect(waitingHtml).toContain("Waiting for the session");
    expect(waitingHtml).toContain("window.shape");

    const pushed = await post(app, "/v1/shape/screens", {
      name: "choices",
      html: `<h2>Pick</h2>
<div class="options">
  <div class="option" data-choice="a" data-recommended onclick="toggleSelect(this)">
    <span class="badge">recommended</span> A
  </div>
  <div class="option" data-choice="b" onclick="toggleSelect(this)">B</div>
</div>`,
    });
    expect(pushed.status).toBe(201);

    const page = await app.request("/shape/");
    const html = await page.text();
    expect(html).toContain("data-recommended");
    expect(html).toContain("window.shape");
    expect(html).toContain("BASE = '/shape'");
    expect(html).toContain("shapePath('/events-stream')");
    expect(html).toContain("/shape/fonts/");

    const click = await app.request("/shape/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "click", choice: "a", text: "A", timestamp: Date.now() }),
    });
    expect(click.status).toBe(204);

    const events = await (await app.request("/v1/shape/events")).json();
    expect(events.events).toEqual([expect.objectContaining({ choice: "a" })]);
    expect(readFileSync(join(info.state_dir, "events"), "utf8")).toContain('"choice":"a"');

    // New screen clears prior events.
    await post(app, "/v1/shape/screens", { name: "next", html: "<p>next</p>" });
    expect(existsSync(join(info.state_dir, "events"))).toBe(false);

    const ended = await post(app, "/v1/shape/end");
    expect(ended.status).toBe(200);
    expect(existsSync(join(info.state_dir, "server-stopped"))).toBe(true);
    expect(existsSync(join(info.state_dir, "server-info"))).toBe(false);

    stopContentWatch(dir);
  });

  test("SSE subscribe receives reload after screen push", async () => {
    const { app, dir } = appFor();
    await post(app, "/v1/shape/ensure");

    const sseRes = await app.request("/shape/events-stream");
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get("content-type")).toContain("text/event-stream");

    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    // Drain the retry preamble
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain("retry:");

    await post(app, "/v1/shape/screens", { name: "one", html: "<p>one</p>" });

    const next = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), 1000),
      ),
    ]);
    expect(next.done).toBe(false);
    const chunk = decoder.decode(next.value);
    expect(chunk).toContain('"type":"reload"');

    await reader.cancel();
    stopContentWatch(dir);
  });

  test("file write into screen_dir also triggers reload", async () => {
    const { app, dir } = appFor();
    const info = await (await post(app, "/v1/shape/ensure")).json();

    const sseRes = await app.request("/shape/events-stream");
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // retry

    writeFileSync(join(info.screen_dir, "from-disk.html"), "<p>disk</p>");

    let saw = false;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !saw) {
      const next = await reader.read();
      if (next.done) break;
      if (decoder.decode(next.value).includes('"type":"reload"')) saw = true;
    }
    expect(saw).toBe(true);

    const page = await (await app.request("/shape/")).text();
    expect(page).toContain("disk");

    await reader.cancel();
    await post(app, "/v1/shape/end");
    stopContentWatch(dir);
  });

  test("retired server.cjs refuses to start", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", join(import.meta.dir, "../.claude/skills/shape/scripts/server.cjs")],
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(1);
    const err = await new Response(proc.stderr).text();
    expect(err).toContain("retired");
  });
});
