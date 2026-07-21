import { Link, Outlet } from "@tanstack/react-router";

export function RootRoute() {
  return (
    <div className="ui-shell">
      <nav aria-label="Primary">
        <Link to="/">Existing tasks</Link>
        <Link to="/campaigns">Campaigns</Link>
      </nav>
      <Outlet />
    </div>
  );
}
