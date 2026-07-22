# Codex host installation

Codex installs Quirks through the plugin manifest at `.codex-plugin/plugin.json`.

## Package layout

The shipped plugin contains:

- `.codex-plugin/plugin.json`
- canonical `skills/`
- bounded `references/` host and runner docs

Validate and build the deterministic package tarball with:

```bash
node scripts/package-plugin.mjs
```

`pnpm validate:skills` remains the CI gate for skill frontmatter and credential/home-path scans.

## Install

Use the Codex plugin or marketplace mechanism to register this repository. Do not copy `skills/` into target repositories.

## Control-plane entry

Codex host sessions translate natural-language requests into `quirks-campaign` argv operations. See `references/runners/codex.md` for runner details.
