import { useParams } from "@tanstack/react-router";

export function CampaignDetailRoute() {
  const { campaignId } = useParams({ strict: false }) as { campaignId?: string };
  return (
    <section>
      <h1>Campaign</h1>
      <p>Campaign: {campaignId ?? "unknown"}</p>
    </section>
  );
}
