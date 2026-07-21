import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const forbiddenPatterns = [
  /\bdangerouslySetInnerHTML\b/,
  /\.innerHTML\b/,
  /javascript:/i,
  /data:text\/html/i,
  /\b(html|markup)\s*[:=]/i,
];

test("client TSX does not use raw HTML sinks or inline HTML markup props", async () => {
  const root = path.resolve("src/ui/client");
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .toSorted();
  assert.ok(files.length > 0, "expected client TSX files to scan");

  const violations: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(process.cwd(), file)} matches ${pattern}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
