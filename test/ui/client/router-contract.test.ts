import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryHistory, isNotFound } from "@tanstack/react-router";
import { createAppRouter } from "../../../src/ui/client/router.js";

function makeRouter(initialPath = "/") {
  return createAppRouter({
    context: { queryClient: undefined, apiClient: undefined },
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

test("builds locations for the fixed set of local routes", () => {
  const router = makeRouter();
  assert.equal(router.buildLocation({ to: "/" }).pathname, "/");
  assert.equal(router.buildLocation({ to: "/campaigns" }).pathname, "/campaigns");
  assert.equal(
    router.buildLocation({ to: "/preflight/$campaignId", params: { campaignId: "C-1" } }).pathname,
    "/preflight/C-1",
  );
  assert.equal(
    router.buildLocation({ to: "/campaigns/$campaignId", params: { campaignId: "C-1" } }).pathname,
    "/campaigns/C-1",
  );
  assert.equal(
    router.buildLocation({ to: "/tasks/$taskId/history", params: { taskId: "T-1" } }).pathname,
    "/tasks/T-1/history",
  );
});

test("disables speculative preloading on navigation", () => {
  const router = makeRouter();
  assert.equal(router.options.defaultPreload, false);
});

test("accepts a campaign id within the shared id bounds", () => {
  const router = makeRouter();
  const matches = router.matchRoutes("/preflight/C-1", {}, { throwOnError: false });
  const match = matches.at(-1)!;
  assert.equal(match.paramsError, undefined);
  assert.equal((match.params as Record<string, unknown>)["campaignId"], "C-1");
});

test("rejects a campaign id over the 128-character bound with not-found", () => {
  const router = makeRouter();
  const tooLong = "a".repeat(129);
  const matches = router.matchRoutes(`/preflight/${tooLong}`, {}, { throwOnError: false });
  const match = matches.at(-1)!;
  assert.ok(match.paramsError && isNotFound(match.paramsError));
});

test("rejects a task id with disallowed characters with not-found", () => {
  const router = makeRouter();
  const matches = router.matchRoutes("/tasks/bad id/history", {}, { throwOnError: false });
  const match = matches.at(-1)!;
  assert.ok(match.paramsError && isNotFound(match.paramsError));
});

test("rejects a campaign id that does not start with an alphanumeric character", () => {
  const router = makeRouter();
  const matches = router.matchRoutes("/campaigns/-bad", {}, { throwOnError: false });
  const match = matches.at(-1)!;
  assert.ok(match.paramsError && isNotFound(match.paramsError));
});
