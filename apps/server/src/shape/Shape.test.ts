// QK-COMP-003: shape companion on the quirks service — one session per repo,
// no session key, screens + events over loopback HTTP.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { makeWebHandler } from "../App.ts";
import { stopContentWatch } from "./Session.ts";
import { tempRoot } from "../testing/Harness.ts";

const disposers: Array<() => Promise<void>> = [];

function appFor(root = tempRoot("quirks-shape-")) {
  const { handler, dispose } = makeWebHandler({ root });
  disposers.push(dispose);
  const url = (path: string) => new URL(path, "http://127.0.0.1").toString();
  return {
    root,
    get: (path: string) => handler(new Request(url(path))),
    post: (path: string, body?: unknown) =>
      handler(
        new Request(url(path), {
          method: "POST",
          ...(body === undefined
            ? {}
            : {
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              }),
        }),
      ),
  };
}

afterAll(async () => {
  for (const dispose of disposers) await dispose();
});

describe("shape companion routes", () => {
  it("ensure → waiting page → push screen → framed with helper → click → end", async () => {
    const app = appFor();

    const ensure = await app.post("/v1/shape/ensure");
    expect(ensure.status).toBe(200);
    const info = await ensure.json();
    expect(info.url).toContain("/shape/");
    expect(info.screen_dir).toContain("shape-sessions/current/content");
    expect(existsSync(join(info.state_dir, "server-info"))).toBe(true);

    const waiting = await app.get("/shape/");
    expect(waiting.status).toBe(200);
    const waitingHtml = await waiting.text();
    expect(waitingHtml).toContain("Waiting for the session");
    expect(waitingHtml).toContain("window.shape");

    const pushed = await app.post("/v1/shape/screens", {
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

    const page = await app.get("/shape/");
    const html = await page.text();
    expect(html).toContain("data-recommended");
    expect(html).toContain("window.shape");
    expect(html).toContain("BASE = '/shape'");
    expect(html).toContain("shapePath('/events-stream')");
    expect(html).toContain("/shape/fonts/");

    const click = await app.post("/shape/event", {
      type: "click",
      choice: "a",
      text: "A",
      timestamp: Date.now(),
    });
    expect(click.status).toBe(204);

    const events = await (await app.get("/v1/shape/events")).json();
    expect(events.events).toEqual([expect.objectContaining({ choice: "a" })]);
    expect(readFileSync(join(info.state_dir, "events"), "utf8")).toContain('"choice":"a"');

    // New screen clears prior events.
    await app.post("/v1/shape/screens", { name: "next", html: "<p>next</p>" });
    expect(existsSync(join(info.state_dir, "events"))).toBe(false);

    const ended = await app.post("/v1/shape/end");
    expect(ended.status).toBe(200);
    expect(existsSync(join(info.state_dir, "server-stopped"))).toBe(true);
    expect(existsSync(join(info.state_dir, "server-info"))).toBe(false);

    stopContentWatch(app.root);
  });

  it("a screen push without name or html is a 400, not a silently empty screen", async () => {
    const app = appFor();
    await app.post("/v1/shape/ensure");
    const res = await app.post("/v1/shape/screens", { name: "only-a-name" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("name and html are required");
    stopContentWatch(app.root);
  });

  it("SSE subscribe receives reload after screen push", async () => {
    const app = appFor();
    await app.post("/v1/shape/ensure");

    const sseRes = await app.get("/shape/events-stream");
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get("content-type")).toContain("text/event-stream");

    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    // Drain the retry preamble
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain("retry:");

    await app.post("/v1/shape/screens", { name: "one", html: "<p>one</p>" });

    const next = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), 2000),
      ),
    ]);
    expect(next.done).toBe(false);
    const chunk = decoder.decode(next.value);
    expect(chunk).toContain('"type":"reload"');

    await reader.cancel();
    stopContentWatch(app.root);
  });

  it("file write into screen_dir also triggers reload", async () => {
    const app = appFor();
    const info = await (await app.post("/v1/shape/ensure")).json();

    const sseRes = await app.get("/shape/events-stream");
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // retry

    writeFileSync(join(info.screen_dir, "from-disk.html"), "<p>disk</p>");

    let saw = false;
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && !saw) {
      const next = await reader.read();
      if (next.done) break;
      if (decoder.decode(next.value).includes('"type":"reload"')) saw = true;
    }
    expect(saw).toBe(true);

    const page = await (await app.get("/shape/")).text();
    expect(page).toContain("disk");

    await reader.cancel();
    await app.post("/v1/shape/end");
    stopContentWatch(app.root);
  });

  it("path traversal out of the session directory is refused", async () => {
    const app = appFor();
    await app.post("/v1/shape/ensure");
    expect((await app.get("/shape/files/..%2Ftasks.json")).status).toBe(404);
    expect((await app.get("/shape/fonts/..%2F..%2Fhelper.js")).status).toBe(404);
    stopContentWatch(app.root);
  });
});
