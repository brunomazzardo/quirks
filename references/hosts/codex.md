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

```bash
node hosts/codex/install.mjs
```

Default destination: `~/.codex/skills/quirks` (the codex CLI skill discovery location).

Set `QUIRKS_CODEX_PLUGINS_DIR` to override the install directory in tests and sandboxes.

The installer links the canonical plugin root into the reviewed plugin directory and never copies `skills/` into target repositories. It refuses to overwrite non-link destinations and prints one bounded JSON result when invoked directly.

Install all supported hosts from the repository root:

```bash
node scripts/quirks-install.mjs --all --source . --json
```

Real user-directory installs require `QUIRKS_SMOKE_APPROVED=approve-marketplace-install`.

## Uninstall

```bash
node hosts/codex/uninstall.mjs
```

Removes only the managed `quirks` plugin symlink.

```bash
node scripts/quirks-uninstall.mjs --all --source . --json
```

## Control-plane entry

Codex host sessions translate natural-language requests into `quirks-campaign` argv operations. See `references/runners/codex.md` for runner details.
