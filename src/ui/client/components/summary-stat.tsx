export interface SummaryStatProps {
  label: string;
  value: string;
  detail?: string;
}

/**
 * One approved stat card: micro-label over a bold value with an optional
 * one-line meaning (v3 summary metric, v4 stat card, v5 stat).
 */
export function SummaryStat({ label, value, detail }: SummaryStatProps) {
  return (
    <div className="summary-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}
