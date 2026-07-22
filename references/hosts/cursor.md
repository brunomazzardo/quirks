# Cursor host installation

Cursor exposes Quirks through a managed link under the user skills directory.

## Install

```bash
node hosts/cursor/install.mjs
```

Set `QUIRKS_CURSOR_SKILLS_DIR` in sandboxes to override the destination skills directory.

The installer:

- links `quirks` to this repository root;
- never copies skill files into target repositories;
- refuses to overwrite non-link destinations.

## Uninstall

```bash
node hosts/cursor/uninstall.mjs
```

Removes only the managed `quirks` skills link.

## Control-plane entry

Cursor invokes `quirks-campaign` and `quirks-watchdog` directly. See `references/runners/cursor.md` for runner argv contracts.
