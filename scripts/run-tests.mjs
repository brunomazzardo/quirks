import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

async function collectTests(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTests(absolute));
    if (entry.isFile() && entry.name.endsWith(".test.js")) files.push(absolute);
  }
  return files;
}

const files = (await collectTests(path.resolve("dist/test"))).toSorted();
if (files.length === 0) throw new Error("No compiled tests found under dist/test");
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
