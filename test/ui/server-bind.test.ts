import assert from "node:assert/strict";
import { request } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { createLoopbackAuthority } from "../../src/ui/authority.js";
import { readJsonBody } from "../../src/ui/request.js";
import { createUiServer } from "../../src/ui/server.js";

function fakeRequest(chunks: Buffer[]): IncomingMessage {
  const readable = Readable.from(chunks);
  return readable as unknown as IncomingMessage;
}

test("rejects oversized JSON bodies", async () => {
  const req = fakeRequest([Buffer.alloc(1_048_577)]);
  await assert.rejects(() => readJsonBody(req), /UI_PAYLOAD_TOO_LARGE/);
});

test("binds only to 127.0.0.1 and rejects wrong Host", async () => {
  const authority = await createLoopbackAuthority();
  const server = await createUiServer({
    authority,
    handler: async (_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    },
  });
  try {
    const address = server.address();
    assert.ok(address);
    assert.equal(address.address, "127.0.0.1");

    const bad = await new Promise<number>((resolve, reject) => {
      const req = request({
        host: "127.0.0.1",
        port: authority.port,
        path: "/",
        headers: { Host: "localhost" },
      }, (res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(bad, 403);

    const good = await fetch(`${authority.baseUrl}/`);
    assert.equal(good.status, 200);
    assert.equal(await good.text(), "ok");
  } finally {
    await server.close();
  }
});
