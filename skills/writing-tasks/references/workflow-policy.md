# Workflow policy for task authoring

## Design gates

- Honor `workflow.designGate.required` from project workflow policy.
- Block proposals that disable or bypass design gates without explicit human approval recorded in the task source.

## Dependencies

- Every `dependsOn` entry must reference an existing task id in the selected source.
- Reject circular or cross-campaign dependency edges.

## Scope

- Task proposals must stay within the approved campaign envelope and must not broaden `parallelismKeys` or execution capabilities without a new approved campaign.

## Provenance

- Record compact `sourceRefs` only—never paste plan or spec bodies into task JSON.
