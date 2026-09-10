## Why

The production Memory contract requires Kun to inject no long-term memory when authorized candidates have no positive foundation relevance. The current shared gate treats any positive lexical token coverage as relevant, including weak common trigram or single-term overlaps; the v2 development safety cases q033 and q034 therefore consume the injection budget with unrelated records. This needs a production fix independent of semantic retrieval or terminology-map experiments.

## What Changes

- Add a versioned, deterministic lexical relevance gate shared by SQLite FTS5 and filesystem fallback.
- Require lexical-only candidates to meet the calibrated foundation threshold before ranking and context-budget selection; preserve explicit type-affinity retrieval.
- Add anonymous regression fixtures and traces for q033/q034 false positives and q035/q036 correct abstention.
- Verify the same gate and selected ids through both the real SQLite index and filesystem fallback.
- Evaluate the gate against the complete v2 development split so abstention, Recall@K, Precision@K, MRR, scope/lifecycle safety, and multilingual behavior are visible together.
- Keep semantic candidates, terminology-map productionization, model assets, and vector indexes out of this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memory-retrieval-foundation`: define positive lexical foundation relevance as meeting the versioned gate rather than merely having any non-zero token overlap, with identical behavior in indexed and degraded paths.

## Impact

- Affects `kun/src/memory/memory-ranking.ts`, `kun/src/memory/memory-retrieval.ts`, SQLite hybrid index integration, and focused Memory retrieval tests.
- Changes which weak lexical candidates can be injected; scope, lifecycle, authority, prompt budget, and fallback contracts remain unchanged.
- Adds no runtime dependency, model, schema migration, public API, or packaged asset.
