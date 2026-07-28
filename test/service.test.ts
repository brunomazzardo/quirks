// The service routes, exercised in-process via app.request() — every CLI verb
// has a route equivalent, list routes paginate, errors map to honest statuses.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/service/app.ts";

function appFor(dir = mkdtempSync(join(tmpdir(), "quirks-svc-"))) {
  return { app: createApp({ root: dir, dir: join(dir, ".quirks") }), dir };
}

async function post(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("service routes", () => {
  test("goal new → task propose → claim → complete, end to end", async () => {
    const { app } = appFor();

    const goal = await post(app, "/v1/goals", {
      id: "QK-TST",
      title: "test goal",
      why: "prove the routes work",
      doneWhen: ["the suite passes"],
    });
    expect(goal.status).toBe(201);
    expect((await goal.json()).id).toBe("QK-TST");

    const t1 = await post(app, "/v1/tasks", { title: "first", goal: "QK-TST" });
    expect(t1.status).toBe(201);
    expect((await t1.json()).id).toBe("QK-TST-001");

    const t2 = await post(app, "/v1/tasks", {
      title: "second",
      goal: "QK-TST",
      dependsOn: ["QK-TST-001"],
    });
    expect((await t2.json()).dependsOn).toEqual(["QK-TST-001"]);

    // Dependency gate: 409, naming the incomplete dependency.
    const early = await post(app, "/v1/tasks/QK-TST-002/claim", {});
    expect(early.status).toBe(409);
    expect((await early.json()).error).toContain("QK-TST-001");

    expect((await post(app, "/v1/tasks/QK-TST-001/claim", { by: "svc-test" })).status).toBe(200);
    expect((await post(app, "/v1/tasks/QK-TST-001/complete", { evidence: "done" })).status).toBe(200);
    expect((await post(app, "/v1/tasks/QK-TST-002/claim", {})).status).toBe(200);

    const rollupRes = await app.request("/v1/goals");
    const rollup = await rollupRes.json();
    expect(rollup.items).toEqual([
      expect.objectContaining({ id: "QK-TST", total: 2, done: 1, open: 1, state: "in progress" }),
    ]);
  });

  test("goal show, done-without-reason 400, done 200, hidden from default rollup", async () => {
    const { app } = appFor();
    await post(app, "/v1/goals", { id: "QK-GG", title: "g", why: "w", doneWhen: [] });

    const show = await app.request("/v1/goals/QK-GG");
    expect(show.status).toBe(200);
    expect((await show.json()).goal.id).toBe("QK-GG");

    expect((await post(app, "/v1/goals/QK-GG/done", {})).status).toBe(400);
    expect((await post(app, "/v1/goals/QK-GG/done", { reason: "criteria met" })).status).toBe(200);

    const def = await (await app.request("/v1/goals")).json();
    expect(def.items).toEqual([]);
    const all = await (await app.request("/v1/goals?all=true")).json();
    expect(all.items.length).toBe(1);
  });

  test("list routes paginate with offset and limit", async () => {
    const { app } = appFor();
    for (let i = 0; i < 5; i++) {
      await post(app, "/v1/tasks", { title: `t${i}` });
    }
    const pageRes = await (await app.request("/v1/tasks?offset=1&limit=2")).json();
    expect(pageRes.total).toBe(5);
    expect(pageRes.items.map((t: { id: string }) => t.id)).toEqual(["QK-002", "QK-003"]);
  });

  test("unknown task is 404; revision conflict is 409", async () => {
    const { app } = appFor();
    expect((await app.request("/v1/tasks/QK-999")).status).toBe(404);
    await post(app, "/v1/tasks", { title: "t" });
    const conflict = await post(app, "/v1/tasks/QK-001/block", { reason: "r", ifRevision: 99 });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toContain("revision");
  });

  test("a corrupt store is 500 with the corrupt teaching, never an empty list", async () => {
    const { app, dir } = appFor();
    await post(app, "/v1/tasks", { title: "seed" });
    writeFileSync(join(dir, ".quirks", "tasks.json"), "{ torn");
    const res = await app.request("/v1/tasks");
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("corrupt");
  });
});
