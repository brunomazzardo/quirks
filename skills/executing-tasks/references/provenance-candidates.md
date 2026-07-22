# Provenance candidates

## Validation

- Submit only compact provenance candidates validated by `validateProvenanceCandidate`.
- Include exact commit SHAs reproduced with `git rev-parse` or equivalent verification commands.
- Use repository-relative POSIX paths only—reject absolute paths and `..` traversal.

## Completion boundary

Honor `completionBoundary` from task metadata (`accepted-commit`, `campaign-merge`, etc.).

## Sync acknowledgement

Never call `complete` while `pending_sync` is true or before sync acknowledgement for the attached provenance.
