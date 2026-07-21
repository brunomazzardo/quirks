import assert from "node:assert/strict";
import test from "node:test";
import { consumeFragmentTokens } from "../../../src/ui/client/token-vault.js";

test("consumes split fragment credentials and strips them without history state", () => {
  const replaced: unknown[][] = [];
  const vault = consumeFragmentTokens({
    href: "http://127.0.0.1:9123/preflight/C-1#viewToken=qkview_read&approvalToken=qkapprove_write",
    replaceState: (...args: unknown[]) => replaced.push(args),
  });
  assert.equal(vault.withViewerToken((token) => token), "qkview_read");
  assert.equal(vault.withApprovalToken((token) => token), "qkapprove_write");
  assert.deepEqual(replaced, [[null, "", "/preflight/C-1"]]);
  vault.clearApproval();
  assert.equal(vault.withApprovalToken(() => "present"), undefined);
  assert.equal(vault.withViewerToken((token) => token), "qkview_read");
  vault.clearAll();
  assert.equal(vault.withViewerToken(() => "present"), undefined);
});

test("rejects duplicate and unknown fragment keys", () => {
  assert.throws(
    () =>
      consumeFragmentTokens({
        href: "http://127.0.0.1:9123/#viewToken=a&viewToken=b",
        replaceState: () => {},
      }),
    /viewToken/,
  );
  assert.throws(
    () =>
      consumeFragmentTokens({
        href: "http://127.0.0.1:9123/#viewToken=a&evil=1",
        replaceState: () => {},
      }),
    /unknown fragment key/,
  );
});
