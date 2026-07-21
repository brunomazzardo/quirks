import { useParams } from "@tanstack/react-router";
import { PreflightView } from "../views/preflight-view.js";

export function PreflightRoute() {
  const { campaignId } = useParams({ from: "/preflight/$campaignId" });
  return <PreflightView campaignId={campaignId} />;
}
