// The read/write split, at the one place it is decided.
//
// The end-to-end suite (Cli.test.ts) can only ever prove the *piped* half: a
// spawned child has no terminal, and allocating a pty to prove a table renders
// would test the pty. So the fact that decides it — `process.stdout.isTTY` — is
// stated here, and the table text itself is asserted in Render.test.ts.

import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { emitRead, table } from "./Output.ts";

/** Run a verb's emit with a stated stdout, capturing what it printed. */
function printed(isTTY: boolean, effect: (json: boolean) => Effect.Effect<void>, json = false) {
  const stdout = process.stdout;
  const original = stdout.isTTY;
  const lines: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    stdout.isTTY = isTTY;
    Effect.runSync(effect(json));
  } finally {
    stdout.isTTY = original;
    console.log = log;
  }
  return lines.join("\n");
}

const data = [{ id: "QK-001", n: 1 }];
const render = () => "a table";

describe("reads on a TTY, JSON everywhere else", () => {
  it("renders on a terminal and serialises when piped", () => {
    expect(printed(true, (json) => emitRead(data, json, render))).toBe("a table");
    expect(printed(false, (json) => emitRead(data, json, render))).toBe(
      JSON.stringify(data, null, 2),
    );
  });

  it("--json wins on a terminal — the flag exists to be believed", () => {
    expect(printed(true, (json) => emitRead(data, json, render), true)).toBe(
      JSON.stringify(data, null, 2),
    );
  });

  it("a render that would throw is never called on the piped path", () => {
    const explode = () => {
      throw new Error("rendered when it should not have been");
    };
    expect(printed(false, (json) => emitRead(data, json, explode))).toBe(
      JSON.stringify(data, null, 2),
    );
  });
});

describe("table", () => {
  it("pads every column to its widest cell, header included", () => {
    expect(
      table(
        ["task", "status"],
        [
          ["QK-1", "open"],
          ["QK-LONGER", "blocked"],
        ],
      ),
    ).toBe(["task       status", "QK-1       open", "QK-LONGER  blocked"].join("\n"));
  });

  it("trims the trailing pad, so a copied line carries no invisible tail", () => {
    const lines = table(["a", "bbbb"], [["x", ""]]).split("\n");
    expect(lines[1]).toBe("x");
    expect(lines.every((l) => l === l.trimEnd())).toBe(true);
  });

  it("a missing cell is padded, never misaligned", () => {
    expect(table(["a", "b"], [["1"]])).toBe(["a  b", "1"].join("\n"));
  });

  it("headers alone are a legal table", () => {
    expect(table(["a", "b"], [])).toBe("a  b");
  });
});
