## Why

The v1 and v2 semantic Memory evaluations produced no-go decisions because the fixed `multilingual-e5-small-q8` candidate and its semantic-gated fusion did not satisfy the abstention contract. The evidence is specific to that model/configuration and does not justify a general claim that semantic retrieval cannot work. Before any production embedding work, Kun needs a versioned, holdout-blind comparison of rejection architectures with enough stratified negative and cross-language positive evidence to make a reproducible decision.

## What Changes

- Create a new v3 evaluation and decision version without modifying the frozen v1/v2 evidence.
- Lock `multilingual-e5-small-q8` and its artifact/runtime metadata; compare rejection and fusion architectures rather than changing models.
- Add a pre-registered finite margin/gap grid and a deterministic candidate-selection rule evaluated only on development data.
- Use query-level paired bootstrap confidence lower bounds for quality deltas against the post-#1308 lexical foundation baseline.
- Add first-class strata for cross-language positive queries with zero lexical overlap and report their Recall independently.
- Compare the current semantic-gated-rrf, lexical-veto reranking, lexical-veto with margin, and pure lexical foundation through offline evaluator wrappers.
- Keep terminology-map retrieval as a separately reported exploratory candidate, not a production change.
- Permit holdout evaluation only after candidate identity, parameters, hashes, and all gates are frozen; a failed holdout remains a no-go.
- Keep production retrieval, canonical Memory data, model delivery, and P2-B out of scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `semantic-memory-retrieval-evaluation`: Add the v3 model lock, rejection-architecture comparison, pre-registered margin grid, paired-bootstrap lower-bound gates, cross-language zero-overlap positive stratum, and holdout-lock requirements.

## Impact

- Affects only anonymous evaluation fixtures, dataset manifests, validators, offline candidate wrappers, scoring/reporting utilities, tests, OpenSpec artifacts, and decision evidence under `kun/src/memory`.
- Recalculates the lexical baseline using the production foundation behavior after #1308; it does not rewrite v1/v2 frozen JSON or reports.
- Does not modify canonical Memory JSON, production SQLite/FTS5 or filesystem retrieval, turn injection, renderer/main/HTTP APIs, settings, packaging dependencies, or model download behavior.
- No network access is permitted during candidate evaluation; model bytes remain external to the repository.
