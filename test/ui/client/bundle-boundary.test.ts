import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("bundle has one JavaScript output with zero external imports", async () => {
  const meta = JSON.parse(await readFile("dist/ui/client.bundle.meta.json", "utf8")) as {
    outputs: Record<string, { entryPoint?: string; imports: unknown[] }>;
  };
  const jsOutputs = Object.entries(meta.outputs).filter(([, output]) => output.entryPoint);
  assert.equal(jsOutputs.length, 1);
  const [, output] = jsOutputs[0]!;
  assert.deepEqual(output.imports, []);

  const bundle = await readFile("dist/ui/client.bundle.js", "utf8");
  assert.doesNotMatch(bundle, /sourceMappingURL/);
  assert.doesNotMatch(bundle, /@tanstack\/react-start/);
  assert.doesNotMatch(bundle, /@tanstack\/react-router-devtools|@tanstack\/react-query-devtools/);
  assert.doesNotMatch(bundle, /qkview_read|qkapprove_write/);
});
