// QK-SRV-006 — code identity and drift detection.
// The property that matters most: an unmeasurable tree yields `unknown` and is
// NEVER treated as drift, because acting on ignorance is how a restart loop starts.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UNKNOWN_FINGERPRINT, codeIdentity, fingerprintDir, hasDrifted } from "../src/fingerprint.ts";
import { rootKey, stateDir } from "../src/paths.ts";

function treeWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "quirks-fp-"));
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

describe("fingerprintDir", () => {
  test("is stable across calls on an unchanged tree", () => {
    const dir = treeWith({ "main.ts": "export const a = 1;\n" });
    expect(fingerprintDir(dir).fingerprint).toBe(fingerprintDir(dir).fingerprint);
  });

  test("changes when a file's content changes size", () => {
    const dir = treeWith({ "main.ts": "export const a = 1;\n" });
    const before = fingerprintDir(dir).fingerprint;
    writeFileSync(join(dir, "main.ts"), "export const a = 1; // grew\n");
    expect(fingerprintDir(dir).fingerprint).not.toBe(before);
  });

  test("changes when a file is added, and counts files", () => {
    const dir = treeWith({ "main.ts": "a\n" });
    const before = fingerprintDir(dir);
    expect(before.files).toBe(1);
    writeFileSync(join(dir, "extra.ts"), "b\n");
    const after = fingerprintDir(dir);
    expect(after.files).toBe(2);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  test("descends subdirectories but skips node_modules and dotfiles", () => {
    const dir = treeWith({
      "main.ts": "a\n",
      "cli/run.ts": "b\n",
      "node_modules/pkg/index.ts": "ignored\n",
      ".quirks-snapshots/old/main.ts": "ignored\n",
    });
    // Only main.ts and cli/run.ts count — a snapshot must not feed its own digest.
    expect(fingerprintDir(dir).files).toBe(2);
  });

  test("ignores non-TypeScript files", () => {
    const dir = treeWith({ "main.ts": "a\n" });
    const before = fingerprintDir(dir).fingerprint;
    writeFileSync(join(dir, "README.md"), "docs change\n");
    expect(fingerprintDir(dir).fingerprint).toBe(before);
  });

  test("an empty tree is unknown, not an empty-string digest", () => {
    const identity = fingerprintDir(mkdtempSync(join(tmpdir(), "quirks-empty-")));
    expect(identity.fingerprint).toBe(UNKNOWN_FINGERPRINT);
    expect(identity.source).toBe("unknown");
  });
});

describe("codeIdentity", () => {
  test("measures this repo's own src and reports it as src", () => {
    const identity = codeIdentity();
    expect(identity.source).toBe("src");
    expect(identity.files).toBeGreaterThan(10);
    expect(identity.fingerprint).not.toBe(UNKNOWN_FINGERPRINT);
  });

  test("falls back to the executable when there is no source tree", () => {
    // A `bun build --compile` binary has no src/ beside it.
    const identity = codeIdentity(mkdtempSync(join(tmpdir(), "quirks-nosrc-")));
    expect(identity.source).toBe("executable");
    expect(identity.fingerprint).not.toBe(UNKNOWN_FINGERPRINT);
    expect(identity.dir).toBeNull();
  });
});

describe("hasDrifted — fail open", () => {
  test("two known, different fingerprints are drift", () => {
    expect(hasDrifted("aaa", "bbb")).toBe(true);
  });

  test("identical fingerprints are not drift", () => {
    expect(hasDrifted("aaa", "aaa")).toBe(false);
  });

  test("ignorance is never drift — this is what prevents a restart loop", () => {
    expect(hasDrifted(UNKNOWN_FINGERPRINT, "bbb")).toBe(false);
    expect(hasDrifted("aaa", UNKNOWN_FINGERPRINT)).toBe(false);
    expect(hasDrifted(undefined, "bbb")).toBe(false);
    expect(hasDrifted("aaa", undefined)).toBe(false);
    expect(hasDrifted(undefined, undefined)).toBe(false);
  });
});

describe("paths keep machine state out of the ledger", () => {
  test("the state dir is outside the repo root", () => {
    const root = "/tmp/some/repo";
    expect(stateDir(root).startsWith(root)).toBe(false);
  });

  test("the state dir is per-root, so two repos never share a record", () => {
    expect(stateDir("/a/repo")).not.toBe(stateDir("/b/repo"));
    expect(rootKey("/a/repo")).not.toBe(rootKey("/b/repo"));
  });

  test("QUIRKS_STATE_DIR overrides, which is what keeps tests hermetic", () => {
    const previous = process.env.QUIRKS_STATE_DIR;
    const tmp = mkdtempSync(join(tmpdir(), "quirks-override-"));
    process.env.QUIRKS_STATE_DIR = tmp;
    try {
      expect(stateDir("/a/repo").startsWith(tmp)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.QUIRKS_STATE_DIR;
      else process.env.QUIRKS_STATE_DIR = previous;
    }
  });

  test("machine state never lands inside the .quirks/ ledger directory", () => {
    const root = "/tmp/some/repo";
    expect(stateDir(root).startsWith(`${join(root, ".quirks")}/`)).toBe(false);
  });
});
