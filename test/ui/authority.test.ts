import assert from "node:assert/strict";
import test from "node:test";
import { createLoopbackAuthority } from "../../src/ui/authority.js";

test("allocates loopback authority on 127.0.0.1", async () => {
  const authority = await createLoopbackAuthority();
  assert.equal(authority.host, "127.0.0.1");
  assert.ok(authority.port > 0);
  assert.equal(authority.origin, `http://127.0.0.1:${authority.port}`);
  assert.equal(authority.baseUrl, authority.origin);
  assert.equal(authority.hostHeader, `127.0.0.1:${authority.port}`);
});
