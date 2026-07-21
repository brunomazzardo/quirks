import { StatusBadge, type StatusTone } from "./status-badge.js";

export type SyncHealth = "fresh" | "stale" | "unavailable";

export interface SyncBannerProps {
  pending: number;
  conflicts: number;
  syncHealth?: SyncHealth;
  coordinationNotice?: string;
  leaseNotice?: string;
  refreshedAt?: string;
}

const SYNC_LABEL: Record<SyncHealth, string> = {
  fresh: "Sync fresh",
  stale: "Sync stale",
  unavailable: "Sync unavailable",
};

const SYNC_TONE: Record<SyncHealth, StatusTone> = {
  fresh: "success",
  stale: "warning",
  unavailable: "danger",
};

export function SyncBanner(props: SyncBannerProps) {
  return (
    <div className="sync-banner" role="status">
      {props.syncHealth ? (
        <StatusBadge label={SYNC_LABEL[props.syncHealth]} tone={SYNC_TONE[props.syncHealth]} />
      ) : null}
      <span>Pending writes: {props.pending}</span>
      <span>Conflicts: {props.conflicts}</span>
      {props.coordinationNotice ? <span>{props.coordinationNotice}</span> : null}
      {props.leaseNotice ? <span>{props.leaseNotice}</span> : null}
      {props.refreshedAt ? <span>Refreshed {props.refreshedAt}</span> : null}
    </div>
  );
}
