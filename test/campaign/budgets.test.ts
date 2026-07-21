import assert from "node:assert/strict";
import test from "node:test";
import { BudgetTracker } from "../../src/campaign/budgets.js";

test("increments tasks, wall clock, token estimates, cost estimates, and retries", () => {
  const tracker = new BudgetTracker({
    maxTasks: 3,
    maxWallClockMs: 1_000,
    maxTokens: 10_000,
    maxCostUsd: 2,
    maxRetries: 2,
  });

  tracker.recordTask({
    wallClockMs: 250,
    tokens: { input: 100, output: 50 },
    costUsd: 0.25,
  });
  tracker.recordRetry();

  assert.deepEqual(tracker.snapshot(), {
    tasks: 1,
    wallClockMs: 250,
    tokens: { input: 100, output: 50, total: 150 },
    costUsd: 0.25,
    retries: 1,
  });
});

test("throws BUDGET_EXCEEDED before dispatch when task ceiling would be crossed", () => {
  const tracker = new BudgetTracker({ maxTasks: 1, maxWallClockMs: 1_000, maxRetries: 0 });

  tracker.recordTask({ wallClockMs: 100 });

  assert.throws(() => tracker.assertCanDispatch({ wallClockMs: 1 }), /BUDGET_EXCEEDED/);
});

test("throws BUDGET_EXCEEDED before crossing token, cost, wall-clock, or retry ceilings", () => {
  assert.throws(
    () => new BudgetTracker({ maxTasks: 3, maxWallClockMs: 100, maxRetries: 1 }).assertCanDispatch({ wallClockMs: 101 }),
    /BUDGET_EXCEEDED/,
  );
  assert.throws(
    () => new BudgetTracker({ maxTasks: 3, maxWallClockMs: 100, maxTokens: 10, maxRetries: 1 }).assertCanDispatch({ tokens: { input: 6, output: 5 } }),
    /BUDGET_EXCEEDED/,
  );
  assert.throws(
    () => new BudgetTracker({ maxTasks: 3, maxWallClockMs: 100, maxCostUsd: 0.5, maxRetries: 1 }).assertCanDispatch({ costUsd: 0.51 }),
    /BUDGET_EXCEEDED/,
  );
  assert.throws(
    () => new BudgetTracker({ maxTasks: 3, maxWallClockMs: 100, maxRetries: 0 }).assertCanRetry(),
    /BUDGET_EXCEEDED/,
  );
});
