// The body readers, and specifically the two casts they replaced.
//
// `field<T>(input, key)` was `source?.[key] as T` and `list` was
// `unknown[] as string[]`. Neither looked at what arrived, so a body could name
// a type it was not and be carried into the ops layer wearing it. These tests
// are the difference between a cast and a check.

import { describe, expect, it } from "vite-plus/test";
import { bool, envRecord, int, num, oneOf, str, strList, strListOr } from "./Body.ts";

describe("the readers refuse what they are not", () => {
  it("int: a string that looks like a revision is not a revision", () => {
    // The old `field<number>` handed this straight through, typed number.
    expect(int({ ifRevision: "seven" }, "ifRevision")).toBeUndefined();
    expect(int({ ifRevision: 7 }, "ifRevision")).toBe(7);
    expect(int({ ifRevision: 7.5 }, "ifRevision")).toBeUndefined();
  });

  it("num: NaN and Infinity survive typeof and poison every comparison after", () => {
    expect(num({ n: Number.NaN }, "n")).toBeUndefined();
    expect(num({ n: Number.POSITIVE_INFINITY }, "n")).toBeUndefined();
    expect(num({ n: 0 }, "n")).toBe(0);
  });

  it("strList: an array of numbers is not an array of strings", () => {
    // The old `list` cast this to string[]; task ids [1,2] reached ops as such.
    expect(strList({ taskIds: [1, 2] }, "taskIds")).toEqual([]);
    expect(strList({ taskIds: ["QK-001", 2] }, "taskIds")).toEqual(["QK-001"]);
    expect(strList({ taskIds: "QK-001" }, "taskIds")).toBeUndefined();
    expect(strListOr({}, "taskIds")).toEqual([]);
  });

  it("str and bool answer undefined rather than coercing", () => {
    expect(str({ title: 3 }, "title")).toBeUndefined();
    expect(bool({ force: "true" }, "force")).toBeUndefined();
    expect(bool({ force: true }, "force")).toBe(true);
  });

  it("oneOf refuses a value outside the set", () => {
    const modes = ["autonomous", "park-on-issue"] as const;
    expect(oneOf({ mode: "banana" }, "mode", modes)).toBeUndefined();
    expect(oneOf({ mode: "autonomous" }, "mode", modes)).toBe("autonomous");
  });

  it("envRecord keeps only string values, and refuses an array", () => {
    expect(envRecord({ env: { A: "1", B: 2 } }, "env")).toEqual({ A: "1" });
    expect(envRecord({ env: ["A=1"] }, "env")).toBeUndefined();
  });

  it("a null body is not a crash", () => {
    expect(str(null, "anything")).toBeUndefined();
    expect(strListOr(null, "anything")).toEqual([]);
  });
});
