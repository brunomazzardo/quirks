import assert from "node:assert/strict";
import test from "node:test";
import { assertRepositoryRelativePath } from "../../src/core/repository-path.js";

test("accepts normalized repository-relative POSIX paths", () => {
  assert.equal(assertRepositoryRelativePath("docs/spec.md"), "docs/spec.md");
});

for (const value of ["/tmp/spec.md", "../spec.md", "docs/../secret", "a\\b", "a\0b", ""] as const) {
  test(`rejects unsafe path ${JSON.stringify(value)}`, () => {
    assert.throws(() => assertRepositoryRelativePath(value), { name: "QuirksError" });
  });
}
