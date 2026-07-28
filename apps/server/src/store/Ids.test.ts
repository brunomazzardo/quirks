import type { Task } from "@quirks/contracts";
import { describe, expect, it } from "vite-plus/test";
import { BARE_PREFIX, goalIdOfTask, isValidGoalId, mintTaskId } from "./Ids.ts";

function stub(id: string): Task {
  const now = new Date().toISOString();
  return {
    id,
    title: id,
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

describe("goal ids", () => {
  it("prefix form is valid", () => {
    expect(isValidGoalId("QK-SRV")).toBe(true);
    expect(isValidGoalId("QK-NAT2")).toBe(true);
  });

  it("numeric tags are rejected — they would collide with bare task ids", () => {
    expect(isValidGoalId("QK-014")).toBe(false);
    expect(isValidGoalId("QK")).toBe(false);
    expect(isValidGoalId("qk-srv")).toBe(false);
  });

  it("goal of a task id is its prefix; bare tasks have none", () => {
    expect(goalIdOfTask("QK-SRV-003")).toBe("QK-SRV");
    expect(goalIdOfTask("QK-014")).toBeNull();
  });
});

describe("mintTaskId", () => {
  it("first task under a goal", () => {
    expect(mintTaskId([], "QK-SRV")).toBe("QK-SRV-001");
  });

  it("mints max+1, never refills gaps", () => {
    const tasks = [stub("QK-SRV-001"), stub("QK-SRV-005")];
    expect(mintTaskId(tasks, "QK-SRV")).toBe("QK-SRV-006");
  });

  it("prefixes are isolated namespaces", () => {
    const tasks = [stub("QK-SRV-009"), stub("QK-014")];
    expect(mintTaskId(tasks, "QK-NAT")).toBe("QK-NAT-001");
    expect(mintTaskId(tasks, BARE_PREFIX)).toBe("QK-015");
    expect(mintTaskId(tasks, "QK-SRV")).toBe("QK-SRV-010");
  });

  it("grows past three digits without wrapping", () => {
    expect(mintTaskId([stub("QK-SRV-999")], "QK-SRV")).toBe("QK-SRV-1000");
  });
});
