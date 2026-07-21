import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pins only the approved browser stack and exact Intent sources", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
    dependencies: Record<string, string>;
    intent: { skills: string[] };
  };
  const { dependencies, intent } = pkg;
  for (const excluded of ["@tanstack/react-start", "@tanstack/react-store", "@tanstack/react-pacer", "@tanstack/react-virtual"])
    assert.equal(dependencies[excluded], undefined);
  assert.deepEqual(dependencies, {
    "@tanstack/react-form": "1.33.2",
    "@tanstack/react-query": "5.101.4",
    "@tanstack/react-router": "1.170.18",
    "@tanstack/react-table": "8.21.3",
    react: "19.2.8",
    "react-dom": "19.2.8",
  });
  assert.deepEqual(intent.skills, [
    "@tanstack/react-router",
    "@tanstack/react-query",
    "@tanstack/react-table",
    "@tanstack/react-form",
  ]);
});
