import type { ApprovalWritePort } from "../../../src/ui/ports/approval-write.js";
import { InMemoryApprovalTokenStore } from "../../../src/ui/approval/token-store.js";

export type RecordedApprovalEvent = {
  campaignId: string;
  envelopeDigest: string;
  approvalEventId: string;
  operator: { label: string; evidence: string };
};

export class FakeApprovalWritePort implements ApprovalWritePort {
  readonly events: RecordedApprovalEvent[] = [];
  #eventCounter = 0;

  constructor(
    private readonly store: InMemoryApprovalTokenStore,
    private readonly getNow: () => string = () => new Date().toISOString(),
  ) {}

  issueToken(input: { campaignId: string; envelopeDigest: string; now?: string }) {
    return this.store.issue({ ...input, now: input.now ?? this.getNow() });
  }

  async approve(input: {
    campaignId: string;
    envelopeDigest: string;
    approvalToken: string;
    operator: { label: string; evidence: string };
  }) {
    const result = await this.store.consume({
      campaignId: input.campaignId,
      envelopeDigest: input.envelopeDigest,
      approvalToken: input.approvalToken,
      now: this.getNow(),
    });
    if (result !== "ok") return { result };
    const approvalEventId = `approval-${++this.#eventCounter}`;
    this.events.push({
      campaignId: input.campaignId,
      envelopeDigest: input.envelopeDigest,
      approvalEventId,
      operator: input.operator,
    });
    return { result: "approved" as const, approvalEventId };
  }
}
