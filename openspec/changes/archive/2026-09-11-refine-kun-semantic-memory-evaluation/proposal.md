## Why

The first semantic Memory evaluation correctly produced a no-go, but its eight-query holdout allowed one query to move Recall@5 by 12.5 percentage points and left the decision with insufficient statistical resolution. Before considering another model or any production embedding integration, Kun needs a larger independently frozen dataset, uncertainty reporting, and cheaper lexical alternatives measured through the same safety boundary.

## What Changes

- Release an anonymous v2 evaluation corpus with 40 development and 40 holdout queries, balanced across lexical controls, paraphrases, cross-language retrieval, terse/abstract prompts, scope/lifecycle negatives, abstention/safety, and multi-relevant retrieval.
- Require human-readable relevance rationales, complete expected/forbidden labels, deterministic split assignment, immutable hashes, and a new dataset/decision version before candidate results are accepted.
- Add development-only tuning for similarity gates and lexical/semantic fusion weights without exposing holdout labels.
- Add a terminology-map lexical candidate so inexpensive query normalization is compared before another or larger embedding model.
- Report paired per-query deltas and bootstrap confidence intervals alongside Recall@K, Precision@K, MRR, abstention, safety, determinism, and desktop resource evidence.
- Preserve the v1 no-go record and keep SQLite FTS5 plus filesystem fallback as the only production retrieval path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `semantic-memory-retrieval-evaluation`: Increase evaluation power, require development-only candidate tuning, add lexical terminology-map comparison, and make uncertainty and resource evidence part of the next go/no-go contract.

## Impact

- Affects only semantic Memory evaluation fixtures, validators, scoring/reporting utilities, tests, OpenSpec artifacts, and decision evidence under `kun/src/memory`.
- Does not modify canonical Memory JSON, runtime retrieval, SQLite/FTS5 behavior, filesystem fallback, renderer/main/HTTP APIs, application settings, packaging dependencies, or model delivery.
- Reuses local evaluation artifacts only; no model binary or user Memory enters the repository.
