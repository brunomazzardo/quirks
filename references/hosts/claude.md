# Claude Code host installation

Quirks installs into Claude Code through a managed plugin symlink that exposes the canonical `skills/` tree from this repository.

## Install

```bash
node hosts/claude/install.mjs
```

Set `QUIRKS_PLUGINS_DIR` to override the default plugins directory in tests and sandboxes.

The installer:

- resolves the repository root as the plugin source;
- creates `plugins/quirks` as a symlink when the destination is absent;
- refuses to overwrite a non-link destination;
- is idempotent when the existing link already points at this repository.

## Uninstall

```bash
node hosts/claude/uninstall.mjs
```

Removes only the managed `plugins/quirks` symlink. It does not delete user files or credentials.

## Control-plane entry

Claude Code invokes the same `quirks-campaign` and `quirks-watchdog` CLIs as every other host. See `references/runners/claude.md` for runner argv contracts; this file covers host installation only.
