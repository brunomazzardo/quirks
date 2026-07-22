# Host/runner smoke gates

Use the cheapest gate that answers your question. Do **not** run the full paid 9-cell matrix while iterating on harness, argv, or redaction.

| Gate | When | Command | Budget |
|---|---|---|---|
| **Fast** | Every harness/argv/evidence change | `pnpm smoke:fast` | &lt; 1 min |
| **PoC** | After fast is green; prove one real host cell | `pnpm smoke:poc` | ~one cell; prefer &lt; 10 min |
| **Matrix** | Milestone / release claim only | `pnpm smoke:matrix` | 9 cells; expect tens of minutes |

## Fast (`smoke:fast`)

No host CLIs. No approval env. Covers:

- host argv / stdin contracts
- evidence schema + redaction (no raw stdout/stderr in deviations)
- approval-blocked path
- shim harness wiring only

## PoC (`smoke:poc`)

Requires `QUIRKS_SMOKE_APPROVED=approve-paid-runner-probes`.

Default cell: `cursor` host × `cursor` runner (currently the most reliable real-host path).

Override:

```bash
QUIRKS_SMOKE_APPROVED=approve-paid-runner-probes pnpm smoke:poc -- --host claude --runner codex
```

Optional tighter timeout (ms):

```bash
QUIRKS_SMOKE_HOST_TIMEOUT_MS=180000 QUIRKS_SMOKE_APPROVED=approve-paid-runner-probes pnpm smoke:poc
```

## Matrix (`smoke:matrix`)

Full 3×3. Same approval env. Prints **per-cell and total wall-clock** timings. Regenerate `docs/smoke/2026-host-matrix.md` only from this gate (or an explicit single-cell run you intend to publish).

Do not use matrix runs to debug argv/redaction loops.
