export interface BudgetCeilings {
  maxTasks: number;
  maxWallClockMs: number;
  maxRetries: number;
  maxTokens?: number;
  maxCostUsd?: number;
}

export interface TokenEstimate {
  input?: number;
  output?: number;
  total?: number;
}

export interface BudgetIncrement {
  wallClockMs?: number;
  tokens?: TokenEstimate;
  costUsd?: number;
}

export interface BudgetSnapshot {
  tasks: number;
  wallClockMs: number;
  tokens: { input: number; output: number; total: number };
  costUsd: number;
  retries: number;
}

export class BudgetExceededError extends Error {
  override readonly name = "BudgetExceededError";
  readonly code = "BUDGET_EXCEEDED";

  constructor(message = "BUDGET_EXCEEDED") {
    super(message);
  }
}

export class BudgetTracker {
  readonly #ceilings: BudgetCeilings;
  #snapshot: BudgetSnapshot = {
    tasks: 0,
    wallClockMs: 0,
    tokens: { input: 0, output: 0, total: 0 },
    costUsd: 0,
    retries: 0,
  };

  constructor(ceilings: BudgetCeilings, initial?: Partial<BudgetSnapshot>) {
    this.#ceilings = ceilings;
    if (initial) {
      this.#snapshot = {
        tasks: initial.tasks ?? 0,
        wallClockMs: initial.wallClockMs ?? 0,
        tokens: {
          input: initial.tokens?.input ?? 0,
          output: initial.tokens?.output ?? 0,
          total: initial.tokens?.total ?? 0,
        },
        costUsd: initial.costUsd ?? 0,
        retries: initial.retries ?? 0,
      };
    }
  }

  snapshot(): BudgetSnapshot {
    return {
      ...this.#snapshot,
      tokens: { ...this.#snapshot.tokens },
    };
  }

  assertCanDispatch(estimate: BudgetIncrement = {}): void {
    const next = this.#projectTask(estimate);
    this.#assertWithinCeilings(next);
  }

  recordTask(actual: BudgetIncrement = {}): BudgetSnapshot {
    const next = this.#projectTask(actual);
    this.#assertWithinCeilings(next);
    this.#snapshot = next;
    return this.snapshot();
  }

  assertCanRetry(): void {
    if (this.#snapshot.retries + 1 > this.#ceilings.maxRetries) {
      throw new BudgetExceededError();
    }
  }

  recordRetry(): BudgetSnapshot {
    this.assertCanRetry();
    this.#snapshot = { ...this.#snapshot, retries: this.#snapshot.retries + 1 };
    return this.snapshot();
  }

  #projectTask(increment: BudgetIncrement): BudgetSnapshot {
    const tokens = normalizeTokens(increment.tokens);
    return {
      tasks: this.#snapshot.tasks + 1,
      wallClockMs: this.#snapshot.wallClockMs + (increment.wallClockMs ?? 0),
      tokens: {
        input: this.#snapshot.tokens.input + tokens.input,
        output: this.#snapshot.tokens.output + tokens.output,
        total: this.#snapshot.tokens.total + tokens.total,
      },
      costUsd: this.#snapshot.costUsd + (increment.costUsd ?? 0),
      retries: this.#snapshot.retries,
    };
  }

  #assertWithinCeilings(snapshot: BudgetSnapshot): void {
    if (snapshot.tasks > this.#ceilings.maxTasks) {
      throw new BudgetExceededError();
    }
    if (snapshot.wallClockMs > this.#ceilings.maxWallClockMs) {
      throw new BudgetExceededError();
    }
    if (this.#ceilings.maxTokens !== undefined && snapshot.tokens.total > this.#ceilings.maxTokens) {
      throw new BudgetExceededError();
    }
    if (this.#ceilings.maxCostUsd !== undefined && snapshot.costUsd > this.#ceilings.maxCostUsd) {
      throw new BudgetExceededError();
    }
  }
}

function normalizeTokens(tokens: TokenEstimate | undefined): Required<TokenEstimate> {
  const input = tokens?.input ?? 0;
  const output = tokens?.output ?? 0;
  return {
    input,
    output,
    total: tokens?.total ?? input + output,
  };
}
