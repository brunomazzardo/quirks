import assert from "node:assert/strict";
import test from "node:test";
import { claudeResultPath } from "../../src/runner/claude.js";
import { cursorResultPath } from "../../src/runner/cursor.js";
import { resultContractPath } from "../../src/runner/result-contract.js";

/**
 * Which runners need the envelope contract stated in the brief, and which get
 * it enforced by the CLI itself.
 *
 * codex writes the envelope mechanically via --output-schema plus -o, so its
 * brief needs no contract. cursor has no equivalent flag (QK-RUN-005). claude
 * has none either, and `parseClaudeResult` hard-requires a non-empty artifact
 * on disk — yet its brief never stated one, so writing the envelope was left to
 * chance. The 2026-07-24 probe caught this directly: four identical claude
 * cells, one silently wrote no envelope.
 */
test("codex needs no brief-stated result contract because the CLI enforces the envelope", () => {
  assert.equal(resultContractPath("codex", "/tmp/artifacts", "job-1"), undefined);
});

test("cursor carries a brief-stated, job-unique result contract", () => {
  assert.equal(
    resultContractPath("cursor", "/tmp/artifacts", "job-1"),
    cursorResultPath("/tmp/artifacts", "job-1"),
  );
});

test("claude carries a brief-stated, job-unique result contract", () => {
  assert.equal(
    resultContractPath("claude", "/tmp/artifacts", "job-1"),
    claudeResultPath("/tmp/artifacts", "job-1"),
  );
});

test("result contract paths stay distinct per runner and per job", () => {
  const paths = [
    resultContractPath("cursor", "/tmp/artifacts", "job-1"),
    resultContractPath("cursor", "/tmp/artifacts", "job-2"),
    resultContractPath("claude", "/tmp/artifacts", "job-1"),
    resultContractPath("claude", "/tmp/artifacts", "job-2"),
  ];
  assert.equal(new Set(paths).size, paths.length, "every runner/job pair needs its own envelope path");
});
