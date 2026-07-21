export type VisualTone = "neutral" | "info" | "success" | "warning" | "danger";

export type BadgeDescriptor = {
  label: string;
  tone: VisualTone;
};

export type ReadinessState = "ready" | "blocked" | "claimed" | "ineligible" | "conflict";

const READINESS_BADGES: Record<ReadinessState, BadgeDescriptor> = {
  ready: { label: "Ready", tone: "success" },
  blocked: { label: "Blocked", tone: "warning" },
  claimed: { label: "Claimed", tone: "info" },
  ineligible: { label: "Ineligible", tone: "neutral" },
  conflict: { label: "Conflict", tone: "danger" },
};

export function readinessBadge(readiness: ReadinessState): BadgeDescriptor {
  return READINESS_BADGES[readiness];
}

export type ConfidenceLevel = "low" | "medium" | "high";

const CONFIDENCE_BADGES: Record<ConfidenceLevel, BadgeDescriptor> = {
  low: { label: "Low confidence", tone: "warning" },
  medium: { label: "Medium confidence", tone: "info" },
  high: { label: "High confidence", tone: "success" },
};

export function confidenceBadge(confidence: ConfidenceLevel): BadgeDescriptor {
  return CONFIDENCE_BADGES[confidence];
}

export function routeTierLabel(tier: "mechanical" | "standard" | "high" | "principal"): string {
  switch (tier) {
    case "mechanical":
      return "Mechanical";
    case "standard":
      return "Standard";
    case "high":
      return "High";
    case "principal":
      return "Principal";
  }
}
