# Sync conflicts

## Refresh first

Always run `quirks-tasks sync` before claim, status change, or provenance attach operations.

## Conflicts

When provider metadata disagrees with canonical status:

- Surface the conflict to the operator.
- Do not overwrite canonical status locally.
- Wait for reconciliation or explicit human resolution.

## Revisions

Every mutating call must include `expectedNativeRevision` from the latest successful sync or show operation.

## Pending sync

If `pending_sync` is true, block completion transitions and report the outstanding sync boundary honestly.
