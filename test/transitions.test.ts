import { describe, expect, test } from "bun:test";
import { block, claim, complete, release, TransitionError } from "../src/store/transitions.ts";
import type { Task } from "../src/store/types.ts";

function open(): Task {
  const now = new Date().toISOString();
  return {
    id: "QK-TST-001",
    title: "a task",
    status: "open",
    dependsOn: [],
    deliverables: [],
    acceptanceCriteria: [],
    verification: [],
    sourceRefs: [],
    needsDesign: false,
    needsBreakdown: false,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    statusDetail: {},
  };
}

describe("claim", () => {
  test("open → claimed, recording who", () => {
    const t = claim(open(), "parent-agent");
    expect(t.status).toBe("claimed");
    expect(t.statusDetail.claimedBy).toBe("parent-agent");
    expect(t.revision).toBe(2);
  });

  test("claiming a claimed task conflicts", () => {
    expect(() => claim(claim(open()))).toThrow(TransitionError);
  });
});

describe("block and release", () => {
  test("blocked remembers what it interrupted; release restores it", () => {
    const claimed = claim(open(), "me");
    const blocked = block(claimed, "waiting on upstream", "2026-08-01");
    expect(blocked.status).toBe("blocked");
    expect(blocked.statusDetail.priorStatus).toBe("claimed");
    expect(blocked.statusDetail.blockedReason).toBe("waiting on upstream");

    const restored = release(blocked);
    expect(restored.status).toBe("claimed");
    expect(restored.statusDetail.claimedBy).toBe("me");
    expect(restored.statusDetail.blockedReason).toBeUndefined();
    expect(restored.statusDetail.priorStatus).toBeUndefined();
  });

  test("release of a claimed task reopens it and drops the claimant", () => {
    const t = release(claim(open(), "me"));
    expect(t.status).toBe("open");
    expect(t.statusDetail.claimedBy).toBeUndefined();
  });

  test("release of an open task is a conflict, not a no-op", () => {
    expect(() => release(open())).toThrow(TransitionError);
  });

  test("a completed task cannot be blocked", () => {
    expect(() => block(complete(open()), "why")).toThrow(TransitionError);
  });
});

describe("complete", () => {
  test("permissive: completes straight from open, with evidence", () => {
    const t = complete(open(), "closed by hand, verified manually");
    expect(t.status).toBe("completed");
    expect(t.statusDetail.evidence).toBe("closed by hand, verified manually");
  });

  test("completes from blocked, clearing block baggage", () => {
    const t = complete(block(open(), "was stuck"));
    expect(t.status).toBe("completed");
    expect(t.statusDetail.blockedReason).toBeUndefined();
  });

  test("completing twice conflicts", () => {
    expect(() => complete(complete(open()))).toThrow(TransitionError);
  });
});
