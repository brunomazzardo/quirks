// End-to-end through the real binary: spawned, piped (so output is JSON), in a
// temp dir with no git repo — pins fall back to null and nothing prompts.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAIN = new URL("../src/main.ts", import.meta.url).pathname;

function run(cwd: string, ...args: string[]) {
  const proc = Bun.spawnSync(["bun", MAIN, ...args], { cwd, stderr: "pipe", stdout: "pipe" });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("quirks CLI", () => {
  const cwd = mkdtempSync(join(tmpdir(), "quirks-cli-"));

  test("goal new → task propose → claim → complete, all JSON when piped", () => {
    const goal = run(
      cwd, "goal", "new", "QK-TST",
      "--title", "test goal",
      "--why", "prove step 1 works end to end",
      "--done-when", "the CLI suite passes",
    );
    expect(goal.code).toBe(0);
    expect(JSON.parse(goal.stdout).id).toBe("QK-TST");

    const t1 = run(cwd, "task", "propose", "--goal", "QK-TST", "--title", "first");
    expect(JSON.parse(t1.stdout).id).toBe("QK-TST-001");

    const t2 = run(
      cwd, "task", "propose", "--goal", "QK-TST", "--title", "second",
      "--depends-on", "QK-TST-001",
    );
    expect(JSON.parse(t2.stdout).dependsOn).toEqual(["QK-TST-001"]);

    // Dependency gate: claiming the dependent before its dependency completed fails.
    const blockedClaim = run(cwd, "task", "claim", "QK-TST-002");
    expect(blockedClaim.code).toBe(1);
    expect(blockedClaim.stderr).toContain("QK-TST-001");

    expect(run(cwd, "task", "claim", "QK-TST-001", "--by", "tester").code).toBe(0);
    expect(run(cwd, "task", "complete", "QK-TST-001", "--evidence", "done").code).toBe(0);
    expect(run(cwd, "task", "claim", "QK-TST-002").code).toBe(0);

    const list = run(cwd, "goal", "list");
    const rows = JSON.parse(list.stdout);
    expect(rows).toEqual([
      expect.objectContaining({ id: "QK-TST", total: 2, done: 1, open: 1, state: "in progress" }),
    ]);
  });

  test("bare tasks mint numbers and imply no goal", () => {
    const bare = run(cwd, "task", "propose", "--title", "goal-less chore");
    expect(JSON.parse(bare.stdout).id).toBe("QK-001");
    const rows = JSON.parse(run(cwd, "goal", "list").stdout);
    expect(rows).toContainEqual(expect.objectContaining({ id: "(no goal)", recorded: false }));
  });

  test("leaving active without a reason is refused", () => {
    const done = run(cwd, "goal", "done", "QK-TST");
    expect(done.code).toBe(1);
    expect(done.stderr).toContain("--reason");
  });

  test("a corrupt store is reported, never treated as empty", () => {
    const corruptCwd = mkdtempSync(join(tmpdir(), "quirks-corrupt-"));
    const quirksDir = join(corruptCwd, ".quirks");
    run(corruptCwd, "task", "propose", "--title", "seed"); // creates .quirks/
    writeFileSync(join(quirksDir, "tasks.json"), "{ torn write");
    const out = run(corruptCwd, "task", "list");
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("corrupt");
    const propose = run(corruptCwd, "task", "propose", "--title", "must not clobber");
    expect(propose.code).toBe(1);
  });

  test("unknown revision check conflicts loudly", () => {
    const out = run(cwd, "task", "block", "QK-TST-002", "--reason", "test", "--if-revision", "99");
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("revision");
  });
});
