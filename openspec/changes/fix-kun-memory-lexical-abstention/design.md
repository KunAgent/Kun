## Context

The P0 retrieval specification already requires no injection when every authorized active candidate lacks positive foundation relevance. The current implementation uses `candidate.features.lexical > 0 || candidate.features.typeAffinity > 0` as that decision. Query q033 (credential request) and q034 (customer-list request) receive weak matches through common terms or trigrams, while q035 and q036 correctly return no records.

Both production modes share `retrieveMemoryRecords()` and `hasPositiveMemoryRelevance()`. The indexed path supplies a lexical score equal to the maximum of the same token coverage used by filesystem fallback and normalized FTS5 BM25, so the gate must be corrected in the shared ranking layer and verified through both adapters.

## Goals / Non-Goals

**Goals:**

- Make the “positive foundation relevance” boundary explicit, deterministic, and versioned.
- Reject the known q033/q034 weak matches in both SQLite FTS5 and filesystem fallback.
- Preserve explicit type-affinity retrieval and existing scope/lifecycle filtering.
- Use the complete anonymous v2 development split to select and document the smallest safe threshold that achieves the abstention requirement without hiding regressions in ranked quality.
- Keep traces and diagnostics consistent with the actual selected set.

**Non-Goals:**

- Adding embeddings, changing the E5 evaluator, opening the v2 holdout, or starting P2-B.
- Productionizing the terminology map.
- Adding query-specific deny lists for q033/q034.
- Changing canonical Memory data, SQLite schema, FTS token generation, or public APIs.

## Decisions

### 1. Use one shared lexical gate

Introduce a named foundation threshold, initially calibrated to `0.40` from the frozen v2 development evidence. This is the lowest tested lexical-coverage threshold that makes the four development no-result cases abstain completely while retaining the existing type-affinity path. The value must be a named constant and included in evaluation output/tests so later tuning is visible.

The predicate becomes conceptually:

```ts
candidate.features.typeAffinity > 0 ||
candidate.features.lexical >= MEMORY_MIN_LEXICAL_RELEVANCE
```

The predicate remains shared by SQLite FTS5 and filesystem fallback. BM25 may raise a candidate's lexical score, but cannot bypass the gate when the combined score remains below it.

The current production audit records the shared predicate and filesystem evidence
before this change: q033 and q034 have leading lexical features of approximately
`0.392857` and `0.304348`, while q035 and q036 return no records. The anonymous
regression fixture keeps those observations without changing frozen semantic-memory
v1/v2 evidence. The SQLite integration must reproduce selected ids and bounded lexical
features for all four queries; it is kept separate from this gate commit so a backend
mismatch cannot be hidden by the new threshold.

### 2. Calibrate on the complete development split

The implementation must record baseline and gated metrics for all v2 development categories, including Recall@K, Precision@K, MRR, abstention accuracy, forbidden selections, scope/lifecycle leaks, and deterministic trace hashes. A threshold is not accepted solely because it fixes q033/q034; it must expose the ranked-quality trade-off and pass all zero-tolerance safety gates.

The current evidence suggests `0.40` removes the two false-positive queries while lowering foundation Recall. That trade-off is intentional for a safety bug fix but must be recorded for review. If no threshold satisfies the agreed quality/safety constraints, pause implementation and revise this design rather than silently weakening the product contract.

### 3. Test both retrieval modes without duplicating business logic

Add one shared ranking test for the gate and one hybrid-store/in-memory SQLite integration test that builds the FTS projection from the anonymous records, retrieves q033–q036, and compares selected ids, gate decisions, and bounded trace features with filesystem fallback. Do not alter the fallback to compensate for an indexed-only discrepancy.

### 4. Keep the fix narrow and reversible

No new configuration field is exposed to users. The threshold is a code-level foundation version constant. Rollback is a single commit reverting the gate and its fixtures; no data migration is required.

## Risks / Trade-offs

- A stricter lexical gate may reduce Recall@K for weakly worded queries. Mitigation: record the full v2 development metric delta and preserve type affinity; semantic retrieval remains a separate future decision.
- A fixed threshold can behave differently across languages. Mitigation: keep English/CJK cases in the same development matrix and require deterministic cross-mode tests.
- BM25 normalization may change with SQLite versions. Mitigation: the coverage floor and shared predicate remain authoritative; record SQLite path scores in integration evidence.
- Existing callers may rely on weak matches. Mitigation: this change follows the already-approved no-unrelated-injection contract and adds explicit regression evidence before merge.

## Migration Plan

1. Commit the OpenSpec contract and anonymous audit fixture.
2. Add shared gate tests and SQLite/filesystem reproduction.
3. Implement the calibrated gate and run focused plus complete v2 development evaluation.
4. Run repository gates, update roadmap/evidence, and create the production fix PR.

Rollback is reverting the gate commit; canonical records and index schema remain compatible.
