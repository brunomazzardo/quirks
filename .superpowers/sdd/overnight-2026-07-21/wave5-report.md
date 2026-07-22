# Wave 5 overnight report — host packaging

**Date:** 2026-07-22  
**Base:** `main` @ `82819493021397fbe8aa640e6577a836ca9e32e5`  
**Integration branch:** `wave/w5-hosts`  
**Integration tip:** `47642242cc2973cc5898ce99e9781d517b80d730`

## Lane results

| Lane | Task | Branch | Tip SHA |
|---|---|---|---|
| QK-HOST-002A | Codex plugin packaging | `wave/qk-host-002a` | `e1183162379c58000d55363c9c7f24a86dbaf95a` |
| QK-HOST-002B | Claude Code integration | `wave/qk-host-002b` | `d37cdd9474a53c6efbbd5c493745b05963499c7c` |
| QK-HOST-002C | Cursor integration | `wave/qk-host-002c` | `1c989030076b1ea72428f438c6421c07eb0d9140` |
| QK-HOST-002D | Marketplace metadata | `wave/qk-host-002d` | `e9dd36ae15b48cb3bbc7c923492c631368d2f791` |
| QK-HOST-002E | Host install references | `wave/qk-host-002e` | `edb60ac6f494f1c18ba33ea5b927be3a0807c1da` |
| QK-HOST-002F | Skill discovery verification | `wave/qk-host-002f` | `47642242cc2973cc5898ce99e9781d517b80d730` |

## Delivered

- `scripts/package-plugin.mjs` — deterministic tarball build + credential/home-path scans
- `hosts/claude/*`, `hosts/cursor/*`, `hosts/shared/link-install.mjs` — symlink installers with overwrite protection
- `marketplace/manifest.json` — bounded personal marketplace metadata
- `references/hosts/{claude,codex,cursor}.md` + `skills/running-agent-campaigns/references/host-entrypoints.md`
- Host package, install, marketplace, and skill-discovery test suites

## Verification

| Check | Result |
|---|---|
| `pnpm validate:skills` | pass |
| `pnpm lint` / `pnpm typecheck` | pass |
| Host lane tests (package, install, discovery) | pass (15 tests) |

## Boundary verification

- Package validation finds no credentials or personal paths in shipped artifacts
- Link/install tests never overwrite non-link destinations silently
- Codex plugin manifest resolves canonical `skills/` tree
