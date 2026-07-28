// Carried defect (docs/DECISIONS.md, v1's QK-RUN-012 class): a corrupt store
// file is distinguished from an absent one and reported loudly. It is never
// silently replaced, and absence is never inferred from "could not read".
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";
import { loadJsonFile, saveJsonFile, StoreCorruptError } from "./JsonFile.ts";
import { runPlatform, runPlatformError, tempRoot } from "../testing/Harness.ts";

describe("loadJsonFile", () => {
  it("absent is a normal outcome, not an error", async () => {
    const result = await runPlatform(loadJsonFile(join(tempRoot(), "nope.json")));
    expect(Option.isNone(result)).toBe(true);
  });

  it("roundtrips through saveJsonFile", async () => {
    const path = join(tempRoot(), "a", "b", "data.json");
    await runPlatform(saveJsonFile(path, { version: 1, tasks: [] }));
    const result = await runPlatform(loadJsonFile(path));
    expect(Option.getOrElse(result, () => null)).toEqual({ version: 1, tasks: [] });
  });

  it("corrupt JSON fails loudly, never reads as empty", async () => {
    const path = join(tempRoot(), "tasks.json");
    writeFileSync(path, "{ definitely not json");
    const error = await runPlatformError(loadJsonFile(path));
    expect(error).toBeInstanceOf(StoreCorruptError);
    expect(error.message).toContain(path);
    expect(error.message).toContain("corrupt store file");
    expect(error.message).toContain("Refusing to treat it as empty");
  });

  it("an unreadable file is corrupt, not absent — a directory is not an empty store", async () => {
    const dir = tempRoot();
    // A directory where a file belongs: readable() fails with something that is
    // emphatically not ENOENT, and must not read as "no data yet".
    const error = await runPlatformError(loadJsonFile(dir));
    expect(error).toBeInstanceOf(StoreCorruptError);
    expect(error.message).toContain("Refusing to treat it as empty");
  });

  it("no temp files survive a save", async () => {
    const dir = tempRoot();
    const path = join(dir, "data.json");
    await runPlatform(saveJsonFile(path, { ok: true }));
    expect(readdirSync(dir)).toEqual(["data.json"]);
  });
});
