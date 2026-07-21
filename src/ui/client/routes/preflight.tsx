import { useParams } from "@tanstack/react-router";

export function PreflightRoute() {
  const { campaignId } = useParams({ strict: false }) as { campaignId?: string };
  return (
    <section>
      <h1>Preflight</h1>
      <p>Campaign: {campaignId ?? "unknown"}</p>
    </section>
  );
}
