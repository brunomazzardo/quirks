export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
}

export function StatusBadge({ label, tone }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${tone}`} data-tone={tone}>
      {label}
    </span>
  );
}
