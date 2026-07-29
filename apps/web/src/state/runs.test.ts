// Atom wiring smoke (QK-WB-007): the two run reads, against a stubbed fetch.
//
// Not a rendering test — the unit project runs in node, and what is worth
// pinning here is the wire contract anyway: which URL is requested, that the
// paged walk terminates, and that a bad status becomes a readable failure
// rather than an empty list. A run list that quietly rendered "no runs"
// because the daemon answered 500 would be the exact dishonesty this product
// is built against.

import type { Run } from "@quirks/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { Atom, AtomRegistry, type AsyncResult } from "effect/unstable/reactivity";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { runAtom, runsAtom } from "./runs";

interface Requested {
  readonly url: string;
}

function stubFetch(handler: (url: string) => { status?: number; body: unknown }): Requested[] {
  const seen: Requested[] = [];
  vi.stubGlobal("fetch", (input: string) => {
    seen.push({ url: input });
    const { status = 200, body } = handler(input);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  });
  return seen;
}

function page(items: readonly Run[], total = items.length) {
  return { total, offset: 0, limit: 200, items };
}

function run(id: string): Run {
  return {
    id,
    name: id,
    slug: id,
    mode: "autonomous",
    status: "completed",
    taskIds: [],
    plan: [],
    revision: 1,
    createdAt: "2026-07-28T22:00:00.000Z",
    updatedAt: "2026-07-28T22:00:00.000Z",
  };
}

const read = <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) =>
  Effect.runPromiseExit(
    Atom.getResult(atom).pipe(
      Effect.provideService(AtomRegistry.AtomRegistry, AtomRegistry.make()),
    ),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

it("reads the run list same-origin and pages to the end", async () => {
  const seen = stubFetch((url) =>
    url.includes("offset=0") ? { body: page([run("run_a")], 1) } : { body: page([]) },
  );

  const exit = await read(runsAtom);
  expect(Exit.isSuccess(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    expect(exit.value.runs.map((item) => item.id)).toEqual(["run_a"]);
    expect(exit.value.fetchedAt).toBeInstanceOf(Date);
  }
  // Same-origin: a bare path, no host. The daemon sets no CORS headers, so a
  // cross-origin request could not read a byte of this (lib/service.ts).
  expect(seen[0]?.url).toBe("/v1/runs?offset=0&limit=200");
  expect(seen).toHaveLength(1);
});

it("a daemon that answers badly fails loudly rather than reading as empty", async () => {
  stubFetch(() => ({ status: 503, body: { error: "down" } }));

  const exit = await read(runsAtom);
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(String(exit.cause)).toContain("HTTP 503");
  }
});

it("reads one run by the raw route param, escaped", async () => {
  const seen = stubFetch(() => ({ body: run("run_a") }));

  const exit = await read(runAtom("a night/1"));
  expect(Exit.isSuccess(exit)).toBe(true);
  if (Exit.isSuccess(exit)) expect(exit.value.run.id).toBe("run_a");
  expect(seen[0]?.url).toBe("/v1/runs/a%20night%2F1");
});

it("the family hands back one atom per run, so navigating away evicts nothing", () => {
  expect(runAtom("alpha")).toBe(runAtom("alpha"));
  expect(runAtom("alpha")).not.toBe(runAtom("beta"));
});
