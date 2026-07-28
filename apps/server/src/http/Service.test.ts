// The service routes, exercised in-process through the Effect router's Fetch
// handler — every CLI verb has a route equivalent, list routes paginate, errors
// map to honest statuses, and the three QK-MONO-005 routes refuse loudly.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { makeWebHandler } from "../App.ts";
import { tempRoot } from "../testing/Harness.ts";

const disposers: Array<() => Promise<void>> = [];

function appFor(root = tempRoot("quirks-svc-")) {
  const { handler, dispose } = makeWebHandler({ root });
  disposers.push(dispose);
  const url = (path: string) => new URL(path, "http://127.0.0.1").toString();
  return {
    root,
    get: (path: string) => handler(new Request(url(path))),
    post: (path: string, body?: unknown) =>
      handler(
        new Request(url(path), {
          method: "POST",
          ...(body === undefined
            ? {}
            : {
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              }),
        }),
      ),
  };
}

afterAll(async () => {
  for (const dispose of disposers) await dispose();
});

describe("service routes", () => {
  it("goal new → task propose → claim → complete, end to end", async () => {
    const app = appFor();

    const goal = await app.post("/v1/goals", {
      id: "QK-TST",
      title: "test goal",
      why: "prove the routes work",
      doneWhen: ["the suite passes"],
    });
    expect(goal.status).toBe(201);
    expect((await goal.json()).id).toBe("QK-TST");

    const t1 = await app.post("/v1/tasks", { title: "first", goal: "QK-TST" });
    expect(t1.status).toBe(201);
    expect((await t1.json()).id).toBe("QK-TST-001");

    const t2 = await app.post("/v1/tasks", {
      title: "second",
      goal: "QK-TST",
      dependsOn: ["QK-TST-001"],
    });
    expect((await t2.json()).dependsOn).toEqual(["QK-TST-001"]);

    // Dependency gate: 409, naming the incomplete dependency.
    const early = await app.post("/v1/tasks/QK-TST-002/claim", {});
    expect(early.status).toBe(409);
    expect((await early.json()).error).toContain("QK-TST-001");

    expect((await app.post("/v1/tasks/QK-TST-001/claim", { by: "svc-test" })).status).toBe(200);
    expect((await app.post("/v1/tasks/QK-TST-001/complete", { evidence: "done" })).status).toBe(
      200,
    );
    expect((await app.post("/v1/tasks/QK-TST-002/claim", {})).status).toBe(200);

    const rollup = await (await app.get("/v1/goals")).json();
    expect(rollup.items).toEqual([
      expect.objectContaining({ id: "QK-TST", total: 2, done: 1, open: 1, state: "in progress" }),
    ]);
  });

  it("goal show, done-without-reason 400, done 200, hidden from default rollup", async () => {
    const app = appFor();
    await app.post("/v1/goals", { id: "QK-GG", title: "g", why: "w", doneWhen: [] });

    const show = await app.get("/v1/goals/QK-GG");
    expect(show.status).toBe(200);
    expect((await show.json()).goal.id).toBe("QK-GG");

    expect((await app.post("/v1/goals/QK-GG/done", {})).status).toBe(400);
    expect((await app.post("/v1/goals/QK-GG/done", { reason: "criteria met" })).status).toBe(200);

    const def = await (await app.get("/v1/goals")).json();
    expect(def.items).toEqual([]);
    const all = await (await app.get("/v1/goals?all=true")).json();
    expect(all.items.length).toBe(1);
  });

  it("list routes paginate with offset and limit", async () => {
    const app = appFor();
    for (let i = 0; i < 5; i++) {
      await app.post("/v1/tasks", { title: `t${i}` });
    }
    const paged = await (await app.get("/v1/tasks?offset=1&limit=2")).json();
    expect(paged.total).toBe(5);
    expect(paged.items.map((t: { id: string }) => t.id)).toEqual(["QK-002", "QK-003"]);
  });

  it("unknown task is 404; revision conflict is 409", async () => {
    const app = appFor();
    expect((await app.get("/v1/tasks/QK-999")).status).toBe(404);
    await app.post("/v1/tasks", { title: "t" });
    const conflict = await app.post("/v1/tasks/QK-001/block", { reason: "r", ifRevision: 99 });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toContain("revision");
  });

  it("a corrupt store is 500 with the corrupt teaching, never an empty list", async () => {
    const app = appFor();
    await app.post("/v1/tasks", { title: "seed" });
    writeFileSync(join(app.root, ".quirks", "tasks.json"), "{ torn");
    const res = await app.get("/v1/tasks");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("corrupt");
    expect(body.error).toContain("Refusing to treat it as empty");
    expect(body.items).toBeUndefined();
  });

  it("a blocked task cannot be blocked again: transition refusal is 409", async () => {
    const app = appFor();
    await app.post("/v1/tasks", { title: "t" });
    expect((await app.post("/v1/tasks/QK-001/block", { reason: "waiting" })).status).toBe(200);
    const again = await app.post("/v1/tasks/QK-001/block", { reason: "waiting" });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toContain("already blocked");
    // release restores what block interrupted
    expect((await app.post("/v1/tasks/QK-001/release", {})).status).toBe(200);
  });

  it("runs: plan → dry-run → approve with yes", async () => {
    const app = appFor();
    await app.post("/v1/goals", { id: "QK-RN", title: "r", why: "w", doneWhen: [] });
    const t1 = await (await app.post("/v1/tasks", { title: "a", goal: "QK-RN" })).json();
    await app.post("/v1/tasks", { title: "b", goal: "QK-RN", dependsOn: [t1.id] });

    const plan = await (await app.post("/v1/runs/plan", { name: "svc run", goal: "QK-RN" })).json();
    expect(plan.taskIds).toEqual([t1.id, "QK-RN-002"]);
    // The plan is the approval surface, so it carries what is doubtful about it.
    expect(Array.isArray(plan.warnings)).toBe(true);
    expect(plan.warnings.length).toBeGreaterThan(0);

    expect((await app.post("/v1/runs", { name: "svc run", goal: "QK-RN" })).status).toBe(400);

    const dry = await app.post("/v1/runs", { name: "svc run", goal: "QK-RN", dryRun: true });
    expect(dry.status).toBe(200);
    const dryBody = await dry.json();
    // Brief assembly is QK-MONO-005 — the empty list says so rather than
    // pretending the run needs no briefs.
    expect(dryBody.briefs).toEqual([]);
    expect(dryBody.briefsPending).toContain("QK-MONO-005");

    const created = await app.post("/v1/runs", { name: "svc run", goal: "QK-RN", yes: true });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.run.status).toBe("approved");
    expect((await app.get(`/v1/runs/${body.run.slug}`)).status).toBe(200);
    const listed = await (await app.get("/v1/runs")).json();
    expect(listed.total).toBe(1);
  });

  it("the QK-MONO-005 routes exist and refuse — 501, never a fake success", async () => {
    const app = appFor();
    for (const res of [
      await app.post("/v1/runs/run-001/execute", {}),
      await app.post("/v1/runs/run-001/resume", {}),
      await app.get("/v1/harness"),
    ]) {
      expect(res.status).toBe(501);
      expect(await res.json()).toEqual({ error: "ported in QK-MONO-005" });
    }
  });

  it("/health reports the root it serves, and never claims a corrupt runs file is clear", async () => {
    const app = appFor();
    await app.post("/v1/tasks", { title: "seed the ledger dir" });
    const healthy = await (await app.get("/health")).json();
    expect(healthy.root).toBe(app.root);
    expect(healthy.runsInFlight).toEqual([]);

    writeFileSync(join(app.root, ".quirks", "runs.json"), "{ torn");
    const corrupt = await (await app.get("/health")).json();
    expect(corrupt.runsInFlight).toEqual(["<unreadable runs record>"]);
  });
});
