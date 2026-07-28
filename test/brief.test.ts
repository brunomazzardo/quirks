// The pin is compared against HEAD and the diff reaches the agent —
// never written-and-unread (QK-RUN-002).
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  assembleBrief,
  computeInstructionsHash,
  sourceFact,
} from "../src/ops/brief.ts";
import { proposeTask } from "../src/ops/tasks.ts";
import { createGoal } from "../src/ops/goals.ts";
import type { Store } from "../src/store/store.ts";

function gitInit(): { root: string; store: Store; pin: string } {
  const root = mkdtempSync(join(tmpdir(), "quirks-brief-"));
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "t"], { cwd: root, stdio: "ignore" });
  writeFileSync(join(root, "spec.md"), "version one\n");
  writeFileSync(join(root, "CLAUDE.md"), "# instructions v1\n");
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "pin"], { cwd: root, stdio: "ignore" });
  const pin = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  return { root, store: { root, dir: join(root, ".quirks") }, pin };
}

describe("sourceFact — pin vs HEAD", () => {
  test("unchanged pin yields empty diff and changed=false", () => {
    const { root, pin } = gitInit();
    const fact = sourceFact(root, { path: "spec.md", pinnedCommit: pin }, pin);
    expect(fact.changed).toBe(false);
    expect(fact.diff).toBe("");
    expect(fact.pinnedCommit).toBe(pin);
    expect(fact.headCommit).toBe(pin);
    expect(fact.pinnedLastChanged).toMatch(/^\d{4}-/);
    expect(fact.headLastChanged).toMatch(/^\d{4}-/);
  });

  test("a post-pin edit reaches the agent as a non-empty diff", () => {
    const { root, pin } = gitInit();
    writeFileSync(join(root, "spec.md"), "version two — supersedes v1\n");
    execFileSync("git", ["add", "spec.md"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "drift"], {
      cwd: root,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-07-28T12:00:00",
        GIT_COMMITTER_DATE: "2026-07-28T12:00:00",
      },
    });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

    const fact = sourceFact(root, { path: "spec.md", pinnedCommit: pin }, head);
    expect(fact.changed).toBe(true);
    expect(fact.diff).toContain("version one");
    expect(fact.diff).toContain("version two");
    expect(fact.pinnedCommit).toBe(pin);
    expect(fact.headCommit).toBe(head);
    expect(fact.headLastChanged).toContain("2026-07-28");
  });

  test("a null pin is incomparable — diff null, never fabricated unchanged", () => {
    const { root, pin } = gitInit();
    const fact = sourceFact(root, { path: "spec.md", pinnedCommit: null }, pin);
    expect(fact.diff).toBeNull();
    expect(fact.changed).toBe(false);
  });
});

describe("assembleBrief", () => {
  test("carries pin→HEAD sources, base commit, and instructions hash", () => {
    const { root, store, pin } = gitInit();
    createGoal(store, { id: "QK-TST", title: "t", why: "w", doneWhen: ["done"] });
    const task = proposeTask(store, {
      title: "work",
      goal: "QK-TST",
      dependsOn: [],
      deliverables: ["d"],
      criteria: ["c"],
      verify: ["bun test"],
      sources: ["spec.md"],
      needsDesign: false,
      needsBreakdown: false,
      future: false,
    });
    expect(task.sourceRefs[0]?.pinnedCommit).toBe(pin);

    writeFileSync(join(root, "spec.md"), "version two\n");
    execFileSync("git", ["add", "spec.md"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "drift"], { cwd: root, stdio: "ignore" });

    const brief = assembleBrief(store, task, { operatorNotes: "watch the supersession" });
    expect(brief.goal?.doneWhen).toEqual(["done"]);
    expect(brief.git.baseCommit).not.toBe(pin);
    expect(brief.git.candidateCommit).toBeNull();
    expect(brief.operatorNotes).toBe("watch the supersession");
    expect(brief.instructionsHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(brief.sources).toHaveLength(1);
    expect(brief.sources[0]?.changed).toBe(true);
    expect(brief.sources[0]?.diff).toContain("version two");
    expect(brief.sources[0]?.pinnedCommit).toBe(pin);
  });

  test("instructions hash moves when CLAUDE.md or a skill changes", () => {
    const { root } = gitInit();
    const before = computeInstructionsHash(root);
    writeFileSync(join(root, "CLAUDE.md"), "# instructions v2\n");
    const afterClaude = computeInstructionsHash(root);
    expect(afterClaude).not.toBe(before);

    mkdirSync(join(root, ".claude", "skills", "shape"), { recursive: true });
    writeFileSync(join(root, ".claude", "skills", "shape", "SKILL.md"), "# shape\n");
    const withSkill = computeInstructionsHash(root);
    expect(withSkill).not.toBe(afterClaude);
    writeFileSync(join(root, ".claude", "skills", "shape", "SKILL.md"), "# shape v2\n");
    expect(computeInstructionsHash(root)).not.toBe(withSkill);
  });
});
