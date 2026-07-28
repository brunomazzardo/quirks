import type { Task } from "@quirks/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { block, claim, complete, release, TransitionError } from "./Transitions.ts";

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

/** Transitions are pure and synchronous; a refusal is a typed failure. */
const ok = <A>(effect: Effect.Effect<A, TransitionError>): A => Effect.runSync(effect);
const refused = <A>(effect: Effect.Effect<A, TransitionError>): TransitionError =>
  Effect.runSync(Effect.flip(effect));

describe("claim", () => {
  it("open → claimed, recording who", () => {
    const t = ok(claim(open(), "parent-agent"));
    expect(t.status).toBe("claimed");
    expect(t.statusDetail.claimedBy).toBe("parent-agent");
    expect(t.revision).toBe(2);
  });

  it("claiming a claimed task conflicts", () => {
    const claimed = ok(claim(open()));
    expect(refused(claim(claimed))).toBeInstanceOf(TransitionError);
    expect(refused(claim(claimed)).message).toContain("cannot claim");
  });
});

describe("block and release", () => {
  it("blocked remembers what it interrupted; release restores it", () => {
    const claimed = ok(claim(open(), "me"));
    const blocked = ok(block(claimed, "waiting on upstream", "2026-08-01"));
    expect(blocked.status).toBe("blocked");
    expect(blocked.statusDetail.priorStatus).toBe("claimed");
    expect(blocked.statusDetail.blockedReason).toBe("waiting on upstream");

    const restored = ok(release(blocked));
    expect(restored.status).toBe("claimed");
    expect(restored.statusDetail.claimedBy).toBe("me");
    expect(restored.statusDetail.blockedReason).toBeUndefined();
    expect(restored.statusDetail.priorStatus).toBeUndefined();
  });

  it("release of a claimed task reopens it and drops the claimant", () => {
    const t = ok(release(ok(claim(open(), "me"))));
    expect(t.status).toBe("open");
    expect(t.statusDetail.claimedBy).toBeUndefined();
  });

  it("release of an open task is a conflict, not a no-op", () => {
    expect(refused(release(open()))).toBeInstanceOf(TransitionError);
  });

  it("a completed task cannot be blocked", () => {
    const done = ok(complete(open()));
    expect(refused(block(done, "why"))).toBeInstanceOf(TransitionError);
  });
});

describe("complete", () => {
  it("permissive: completes straight from open, with evidence", () => {
    const t = ok(complete(open(), "closed by hand, verified manually"));
    expect(t.status).toBe("completed");
    expect(t.statusDetail.evidence).toBe("closed by hand, verified manually");
  });

  it("completes from blocked, clearing block baggage", () => {
    const t = ok(complete(ok(block(open(), "was stuck"))));
    expect(t.status).toBe("completed");
    expect(t.statusDetail.blockedReason).toBeUndefined();
  });

  it("completing twice conflicts", () => {
    const done = ok(complete(open()));
    expect(refused(complete(done))).toBeInstanceOf(TransitionError);
  });
});
