// QK-MONO-003 lands the store and HTTP service here; QK-MONO-004 adds the CLI
// and the `quirks` bin. Until then the bun-era src/ at the repo root serves both.
//
// The contract is imported type-only (D3a) — this alias is the proof the
// boundary holds from day one.
import type { Task } from "@quirks/contracts";

export type LedgerTask = Task;
