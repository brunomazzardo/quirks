import { Link, Outlet } from "@tanstack/react-router";

/**
 * Application shell: dark #111827 top bar carrying the Quirks brand and the
 * primary nav over the light workspace canvas (approval-workspace-v3 topbar,
 * v4/v5 `.top`). Task history stays breadcrumb-only per v5's crumb; "Runner
 * health" and "New campaign" are intentionally absent (handoff §6.C/§6.D — no
 * server capability backs them).
 */
export function RootRoute() {
  return (
    <div className="ui-shell">
      <nav aria-label="Primary">
        <div className="nav-inner">
          <span className="brand">Quirks</span>
          <div className="nav-links">
            <Link to="/" activeOptions={{ exact: true }}>
              Existing tasks
            </Link>
            <Link to="/campaigns">Campaigns</Link>
          </div>
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
