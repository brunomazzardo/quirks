import assert from "node:assert/strict";
import test from "node:test";
import { validateVisualReferences, visualAcceptanceCriteria } from "../../src/task-authoring/visual-references.js";
import type { VisualReferenceInput } from "../../src/task-authoring/types.js";

const REFERENCE_COMMIT = "a".repeat(40);

function trackedReference(overrides: Partial<VisualReferenceInput> = {}): VisualReferenceInput {
  return {
    id: "approval-workspace-v3",
    path: "docs/visual-references/quirks-ui/approval-workspace-v3.html",
    availability: "tracked",
    commit: REFERENCE_COMMIT,
    format: "interactive-html",
    governs: ["preflight hierarchy", "approval composition"],
    planTasks: [4, 5],
    verification: "structural-and-screenshot",
    ...overrides,
  };
}

test("keeps visuals optional", () => {
  assert.deepEqual(validateVisualReferences([]), []);
});

test("binds a tracked reference to governed plan tasks", () => {
  const refs = validateVisualReferences([trackedReference()]);
  assert.deepEqual(visualAcceptanceCriteria(refs, [4]), [
    "Conform to approval-workspace-v3 for preflight hierarchy and approval composition per plan Task 4",
  ]);
});

test("names every governed plan task the proposal owns", () => {
  const refs = validateVisualReferences([trackedReference({ governs: ["task workspace", "toolbar density", "inspector composition"] })]);
  assert.deepEqual(visualAcceptanceCriteria(refs, [5, 4]), [
    "Conform to approval-workspace-v3 for task workspace, toolbar density and inspector composition per plan Tasks 4 and 5",
  ]);
});

test("omits references that govern no plan task the proposal owns", () => {
  const refs = validateVisualReferences([trackedReference()]);
  assert.deepEqual(visualAcceptanceCriteria(refs, [1, 2]), []);
});

test("rejects references that govern no concrete decision", () => {
  assert.throws(() => validateVisualReferences([trackedReference({ governs: [] })]), /governed decision/i);
});

test("rejects duplicate reference ids", () => {
  assert.throws(
    () => validateVisualReferences([trackedReference(), trackedReference({ path: "docs/visual-references/quirks-ui/other.html" })]),
    /duplicate/i,
  );
});

test("rejects absolute and escaping reference paths", () => {
  assert.throws(() => validateVisualReferences([trackedReference({ path: "/etc/passwd" })]), /path/i);
  assert.throws(() => validateVisualReferences([trackedReference({ path: "../outside.html" })]), /path/i);
});

test("rejects tracked references without a full lowercase commit", () => {
  assert.throws(() => validateVisualReferences([trackedReference({ commit: "ABCDEF1" })]), /commit/i);
  const { commit: _omitted, ...withoutCommit } = trackedReference();
  assert.throws(() => validateVisualReferences([withoutCommit as VisualReferenceInput]), /commit/i);
});

test("rejects local references that claim a durable commit", () => {
  assert.throws(
    () => validateVisualReferences([trackedReference({ availability: "local", verification: "context-only" })]),
    /commit/i,
  );
});

test("rejects local references that claim screenshot or structural evidence before preservation", () => {
  const { commit: _omitted, ...local } = trackedReference({ availability: "local" });
  for (const verification of ["structural", "screenshot", "structural-and-screenshot"] as const) {
    assert.throws(
      () => validateVisualReferences([{ ...local, verification } as VisualReferenceInput]),
      /preserv/i,
      `local reference must not claim ${verification} evidence`,
    );
  }
});

test("accepts local references that stay contextual or manually reviewed", () => {
  const { commit: _omitted, ...local } = trackedReference({ availability: "local" });
  for (const verification of ["context-only", "manual"] as const) {
    const refs = validateVisualReferences([{ ...local, verification } as VisualReferenceInput]);
    assert.equal(refs[0]!.availability, "local");
    assert.equal(refs[0]!.verification, verification);
  }
});

test("rejects malformed plan-task numbers", () => {
  assert.throws(() => validateVisualReferences([trackedReference({ planTasks: [] })]), /plan task/i);
  assert.throws(() => validateVisualReferences([trackedReference({ planTasks: [4, 4] })]), /duplicate/i);
  assert.throws(() => validateVisualReferences([trackedReference({ planTasks: [0] })]), /plan task/i);
});

test("rejects unknown formats and verification methods", () => {
  assert.throws(
    () => validateVisualReferences([trackedReference({ format: "gif" as VisualReferenceInput["format"] })]),
    /format/i,
  );
  assert.throws(
    () => validateVisualReferences([trackedReference({ verification: "vibes" as VisualReferenceInput["verification"] })]),
    /verification/i,
  );
});
