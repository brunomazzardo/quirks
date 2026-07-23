import type { ReactNode } from "react";
import { StatusBadge, type StatusTone } from "./status-badge.js";

export interface WorkspaceHeaderBadge {
  label: string;
  tone: StatusTone;
}

export interface WorkspaceHeaderProps {
  /** Small uppercase context line above the title (v3 eyebrow / v4 kicker). */
  eyebrow?: string;
  title: string;
  headingId?: string;
  description?: string;
  badges?: readonly WorkspaceHeaderBadge[];
  /** Header action area (copy-prompt surfaces, primary links). */
  actions?: ReactNode;
}

/**
 * Approved workspace header: identity block on the left, status badges and
 * actions on the right (approval-workspace-v3 topbar block, v4 intro, v5 head).
 */
export function WorkspaceHeader({ eyebrow, title, headingId, description, badges, actions }: WorkspaceHeaderProps) {
  return (
    <header className="workspace-header">
      <div>
        {eyebrow ? <span className="micro-label">{eyebrow}</span> : null}
        <h1 {...(headingId ? { id: headingId } : {})}>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {badges?.length || actions ? (
        <div className="workspace-header-side">
          {badges?.length ? (
            <div className="workspace-badges">
              {badges.map((badge) => (
                <StatusBadge key={badge.label} label={badge.label} tone={badge.tone} />
              ))}
            </div>
          ) : null}
          {actions ? <div className="workspace-header-actions">{actions}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
