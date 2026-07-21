import assert from "node:assert/strict";
import test from "node:test";
import { validateProvenanceCandidate } from "../../src/provenance/validate.js";
import type { ArtifactValidation, CommitValidation, OperatorValidation, UrlValidation } from "../../src/provenance/types.js";
import { createGitFixture } from "./support/git-fixture.js";

const fixture = await createGitFixture();

test("accepts a file only when it exists at the stated commit", async () => {
  const result = await validateProvenanceCandidate(fixture.root, {
    kind: "spec",
    path: "docs/spec.md",
    commit: fixture.baseCommit,
  }) as ArtifactValidation;
  assert.equal(result.availability, "available");
});

test("does not substitute current content for a missing historical object", async () => {
  const result = await validateProvenanceCandidate(fixture.root, {
    kind: "plan",
    path: "docs/current-only.md",
    commit: fixture.baseCommit,
  }) as ArtifactValidation;
  assert.equal(result.availability, "missing-at-commit");
  assert.equal(result.currentReplacement, undefined);
});

test("Git names are self-asserted without signature evidence", async () => {
  const result = await validateProvenanceCandidate(fixture.root, { kind: "commit", sha: fixture.baseCommit }) as CommitValidation;
  assert.equal(result.committer?.evidence, "self-asserted-git-metadata");
  assert.equal(result.committer?.verified, false);
});

test("rejects path traversal candidates", async () => {
  const result = await validateProvenanceCandidate(fixture.root, {
    kind: "spec",
    path: "../secret.md",
    commit: fixture.baseCommit,
  }) as ArtifactValidation;
  assert.equal(result.availability, "invalid-path");
});

test("rejects invalid commit SHAs", async () => {
  const result = await validateProvenanceCandidate(fixture.root, {
    kind: "commit",
    sha: "not-a-sha",
  }) as CommitValidation;
  assert.equal(result.availability, "invalid-commit");
});

test("rejects non-https URLs", async () => {
  const result = await validateProvenanceCandidate(fixture.root, {
    kind: "url",
    url: "http://example.com/repo",
  }) as UrlValidation;
  assert.equal(result.availability, "invalid-url");
});

test("rejects URLs with embedded credentials", async () => {
  const result = await validateProvenanceCandidate(fixture.root, {
    kind: "url",
    url: "https://user:pass@example.com/repo",
  }) as UrlValidation;
  assert.equal(result.availability, "invalid-url");
});

test("accepts valid https artifact URLs", async () => {
  const result = await validateProvenanceCandidate(fixture.root, {
    kind: "spec",
    path: "docs/spec.md",
    commit: fixture.baseCommit,
    url: "https://example.com/spec.md",
  }) as ArtifactValidation;
  assert.equal(result.availability, "available");
  assert.equal(result.url, "https://example.com/spec.md");
});

test("keeps author and committer distinct", async () => {
  const result = await validateProvenanceCandidate(fixture.root, { kind: "commit", sha: fixture.baseCommit }) as CommitValidation;
  assert.equal(result.author?.label, "Fixture Author <fixture@example.invalid>");
  assert.equal(result.committer?.label, "Fixture Author <fixture@example.invalid>");
  assert.notEqual(result.author, result.committer);
});

test("operator evidence stays self-asserted unless authenticated", async () => {
  const selfAsserted = await validateProvenanceCandidate(fixture.root, {
    kind: "operator",
    label: "local-user",
    evidence: "self-asserted",
  }) as OperatorValidation;
  assert.equal(selfAsserted.verified, false);

  const authenticated = await validateProvenanceCandidate(fixture.root, {
    kind: "operator",
    label: "provider-user",
    evidence: "authenticated-provider",
  }) as OperatorValidation;
  assert.equal(authenticated.verified, true);
});

test("configured-profile operator evidence is not verified", async () => {
  const result = await validateProvenanceCandidate(fixture.root, {
    kind: "operator",
    label: "profile-user",
    evidence: "configured-profile",
  }) as OperatorValidation;
  assert.equal(result.verified, false);
});

test("commit author stays self-asserted regardless of signature", async () => {
  const result = await validateProvenanceCandidate(fixture.root, {
    kind: "commit",
    sha: fixture.baseCommit,
  }, { allowedSigners: ["Fixture Author <fixture@example.invalid>"] }) as CommitValidation;
  assert.equal(result.author?.evidence, "self-asserted-git-metadata");
  assert.equal(result.author?.verified, false);
});

test("signature metadata alone does not mark a commit verified", async () => {
  const result = await validateProvenanceCandidate(fixture.root, {
    kind: "commit",
    sha: fixture.baseCommit,
  }, { allowedSigners: ["Fixture Author <fixture@example.invalid>"] }) as CommitValidation;
  assert.equal(result.committer?.verified, false);
  assert.notEqual(result.committer?.evidence, "git-signature");
});
