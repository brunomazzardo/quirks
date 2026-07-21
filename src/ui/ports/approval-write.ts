export interface ApprovalWritePort {
  issueToken(input: { campaignId: string; envelopeDigest: string; now?: string }): Promise<{
    approvalToken: string;
    expiresAt: string;
  }>;
  approve(input: {
    campaignId: string;
    envelopeDigest: string;
    approvalToken: string;
    operator: { label: string; evidence: string };
  }): Promise<
    | { result: "approved"; approvalEventId: string }
    | { result: "stale" | "expired" | "replay" | "invalid" }
  >;
}
