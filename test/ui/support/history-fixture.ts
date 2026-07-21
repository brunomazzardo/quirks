import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildTaskHistory } from "../../../src/provenance/read-model.js";
import type { ProvenanceIteration } from "../../../src/provenance/types.js";
import type { JournalEvent } from "../../../src/state/types.js";
import { createGitFixture } from "../../provenance/support/git-fixture.js";

const JOURNAL_PATH = path.resolve("test/ui/fixtures/history-journal.jsonl");

async function loadCampaignEvents(): Promise<JournalEvent[]> {
  const raw = await readFile(JOURNAL_PATH, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JournalEvent);
}

export async function createHistoryFixture() {
  const git = await createGitFixture();
  const campaignEvents = await loadCampaignEvents();

  const executedIteration: ProvenanceIteration = {
    id: "iter-1",
    outcome: "completed",
    completionBoundary: "accepted-commit",
    artifactRefs: [{ kind: "spec", path: "docs/spec.md", commit: git.baseCommit }],
    commitRefs: [git.baseCommit],
    operator: { label: "operator:jane@utilitynyc.com", evidence: "authenticated-host", verified: true },
    gitAuthor: { label: "Signed Author <fixture@example.invalid>", evidence: "git-signature", verified: true },
    gitCommitter: { label: "Signed Author <fixture@example.invalid>", evidence: "git-signature", verified: true },
    participants: [{ role: "agent", runner: "cursor", model: "composer-2.5", effort: "standard" }],
    pullRequestRefs: [{
      provider: "github",
      repository: "org/repo",
      number: 42,
      url: "https://github.com/org/repo/pull/42",
      state: "merged",
      mergeCommit: git.baseCommit,
      opener: { label: "operator:jane@utilitynyc.com", evidence: "authenticated-provider", verified: true },
      merger: { label: "bot:merge-queue", evidence: "authenticated-provider", verified: true },
    }],
  };

  const missingIteration: ProvenanceIteration = {
    id: "iter-missing",
    outcome: "completed",
    completionBoundary: "accepted-commit",
    artifactRefs: [{ kind: "plan", path: "docs/current-only.md", commit: git.baseCommit }],
    commitRefs: [git.baseCommit],
    operator: { label: "operator:jane@utilitynyc.com", evidence: "authenticated-host", verified: true },
    gitAuthor: { label: "unsigned-author@example.invalid", evidence: "self-asserted-git-metadata", verified: false },
    gitCommitter: { label: "unsigned-author@example.invalid", evidence: "self-asserted-git-metadata", verified: false },
  };

  return buildTaskHistory({
    repositoryRoot: git.root,
    taskId: "QK-1",
    sourceProvenance: { schemaVersion: 1, iterations: [executedIteration, missingIteration] },
    campaignEvents,
  });
}
