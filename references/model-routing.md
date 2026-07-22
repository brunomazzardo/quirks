# Model routing policy

Quirks model routing is envelope-bound. Skills reference this policy; runner profiles and `quirks-campaign` enforce it mechanically.

## Principal supervision

- Campaign supervision and delegated specification authoring use principal-tier models (Fable/GPT-5.6 class).
- Principal effort is reserved for envelope-shaping judgment, not mechanical refactors.

## High-tier review and implementation

Approved high-tier models include:

- Grok 4.5 high
- Opus 4.8
- GPT-5.5 high
- GPT-5.6 Terra high

Cross-vendor reviewers are preferred for judgment-heavy review work.

## Routing rules

1. Route from the approved campaign envelope only—never silently downgrade tiers after usage limits.
2. Record usage-limit events without implicit fallback to lower tiers.
3. Match runner profile, tier, and effort to task `execution.effort` and review independence requirements.
4. External routing across Claude, Codex, and Cursor account pools requires `externalRoutingEnabled` in the approved envelope.
5. Delegate runner-specific flags to versioned runner references—do not duplicate vendor flags in skill bodies.

## Prohibited patterns

- Silent tier downgrade after quota or usage-limit events
- Host-native subagent as durable parent
- Model selection outside the approved envelope
