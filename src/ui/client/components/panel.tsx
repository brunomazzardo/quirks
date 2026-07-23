import type { ReactNode } from "react";

export interface PanelProps {
  title: string;
  meta?: string;
  /** Remove body padding so tables, maps, and card grids reach the border. */
  flush?: boolean;
  children: ReactNode;
}

/**
 * Approved workspace panel: white card with a bold title / muted meta head row
 * and a bounded body (v3/v4/v5 `.panel` + `.panel-head`).
 */
export function Panel({ title, meta, flush, children }: PanelProps) {
  return (
    <section className="workspace-panel">
      <header>
        <strong>{title}</strong>
        {meta ? <span>{meta}</span> : null}
      </header>
      <div className={flush ? "workspace-panel-body workspace-panel-body--flush" : "workspace-panel-body"}>
        {children}
      </div>
    </section>
  );
}
