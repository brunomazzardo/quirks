// Argv facts that each cost a repair cycle — regression-locked here.
import { describe, expect, test } from "bun:test";
import { buildClaudeArgv, claudeEffort } from "../src/runner/claude.ts";
import { buildCodexArgv, codexPromptText, codexReasoningEffort, CODEX_PROMPT_MAX_BYTES } from "../src/runner/codex.ts";
import { buildCursorArgv, cursorPromptText } from "../src/runner/cursor.ts";

describe("claude argv", () => {
  test("prompt precedes every flag; --add-dir stays last (variadic)", () => {
    const argv = buildClaudeArgv({
      executable: "claude",
      sessionId: "s1",
      model: "sonnet",
      effort: "standard",
      briefPath: "/tmp/brief.md",
      workspace: "/tmp/ws",
      artifactDir: "/tmp/art",
    });
    expect(argv[0]).toBe("claude");
    expect(argv[1]).toBe("-p");
    // Brief is the first positional after -p/--session-id — before any flag that could absorb it.
    const briefIdx = argv.indexOf("/tmp/brief.md");
    expect(briefIdx).toBe(4);
    expect(argv.slice(0, briefIdx)).toEqual(["claude", "-p", "--session-id", "s1"]);
    // --add-dir is last and takes both dirs; nothing follows.
    const addDir = argv.indexOf("--add-dir");
    expect(argv.slice(addDir)).toEqual(["--add-dir", "/tmp/ws", "/tmp/art"]);
    expect(argv).toContain("--verbose");
    expect(argv).toContain("--dangerously-skip-permissions");
    expect(argv).not.toContainEqual("--file");
  });

  test("effort tiers map; native values pass through", () => {
    expect(claudeEffort("mechanical")).toBe("low");
    expect(claudeEffort("standard")).toBe("medium");
    expect(claudeEffort("principal")).toBe("xhigh");
    expect(claudeEffort("max")).toBe("max");
  });
});

describe("codex argv", () => {
  test("binds workspace with -C and never uses a missing flag", () => {
    const argv = buildCodexArgv({
      executable: "codex",
      model: "gpt-5.5",
      workspace: "/tmp/ws",
      artifactDir: "/tmp/art",
      effort: "high",
      promptText: "do the thing",
    });
    expect(argv).toContain("-C");
    expect(argv[argv.indexOf("-C") + 1]).toBe("/tmp/ws");
    expect(argv).toContain("--json");
    expect(argv.at(-1)).toBe("do the thing");
    expect(argv).toContain("model_reasoning_effort=high");
  });

  test("inlines the brief when it fits; path-only when oversized", () => {
    expect(codexPromptText("/b.md", "short")).toBe("short");
    const huge = "x".repeat(CODEX_PROMPT_MAX_BYTES + 1);
    expect(codexPromptText("/b.md", huge)).toContain("/b.md");
    expect(codexReasoningEffort("principal")).toBe("high");
  });
});

describe("cursor argv", () => {
  test("no --file; prompt is trailing positional; --trust is present", () => {
    const argv = buildCursorArgv({
      executable: "cursor-agent",
      model: "composer-2.5",
      briefPath: "/tmp/brief.md",
      workspace: "/tmp/ws",
      artifactDir: "/tmp/art",
    });
    expect(argv).not.toContain("--file");
    expect(argv).toContain("--trust");
    expect(argv).toContain("--force");
    expect(argv.at(-1)).toBe(cursorPromptText("/tmp/brief.md"));
    expect(argv.at(-1)).toContain("/tmp/brief.md");
  });
});
