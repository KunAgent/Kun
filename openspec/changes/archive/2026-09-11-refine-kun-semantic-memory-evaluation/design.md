## Context

The first P2-A experiment correctly kept semantic retrieval out of production after the locked E5 candidate missed its relevance gates. Its holdout contained only eight queries, so one changed query moved Recall@5 by 12.5 percentage points and the report could not express whether a small observed gain was stable. The next experiment must improve decision quality without changing the current SQLite FTS5 or filesystem retrieval paths.

The existing evaluator already supplies strict anonymous fixtures, common scope and lifecycle filtering, ranked and abstention metrics, safety checks, resource evidence, and a locked go/no-go decision. Version 1 artifacts and their no-go result are historical evidence and must remain reproducible.

## Goals / Non-Goals

**Goals:**

- Freeze a decision-grade v2 dataset with 40 development and 40 holdout queries covering the difficult and safety-critical categories identified by the first experiment.
- Select thresholds and fusion weights using development queries only, then enforce an explicit lock before revealing holdout results.
- Compare the current lexical baseline, a low-cost terminology-map lexical candidate, and any local semantic/hybrid candidate through the same authorization and budget boundary.
- Add paired query-level deltas and deterministic bootstrap confidence intervals so small datasets cannot imply false precision.
- Preserve anonymous, offline, deterministic, reviewable evaluation artifacts.

**Non-Goals:**

- Adding an embedding model, vector index, model downloader, application setting, or packaged dependency.
- Changing production Memory creation, storage, retrieval, ranking, fallback, context injection, or UI/API behavior.
- Reversing the version 1 no-go decision or tuning against its holdout after the fact.
- Proving broad multilingual retrieval quality beyond the frozen synthetic categories.

## Decisions

### 1. Add a versioned v2 dataset contract without mutating v1

Version 1 fixtures, schemas, hashes, and decision output remain unchanged. Version 2 receives its own manifest and strict loader while shared validation and metric helpers are reused where doing so does not weaken either schema. The v2 manifest records record/query hashes, counts, split counts, category quotas, fixed evaluation time, and the versioned decision gates.

This additive approach makes the historical no-go reproducible and avoids disguising a new experiment as a correction to old evidence. A single permissive schema was rejected because it would make accidental v1 field drift harder to detect.

### 2. Use 40 development and 40 holdout queries with explicit primary categories

Each query has one primary category, a human-readable relevance rationale, complete expected and explicit relevance-negative ids, language metadata, and a deterministic split. The manifest validates minimum counts and declared category quotas. Records and queries remain synthetic and anonymous.

Forty queries per split do not eliminate uncertainty, but reduce the movement caused by one query from 12.5 to 2.5 percentage points and are practical to review manually. Larger datasets can become a later version when their labels can be reviewed with the same care.

### 3. Enforce a two-phase development-lock-holdout workflow

Development execution may evaluate only a finite, checked-in grid of similarity gates and fusion weights. It records every configuration and produces a lock artifact identifying one candidate, one parameter set, dataset hashes, terminology-map hash, decision gates, seed, and code/version identity.

Holdout execution requires that lock artifact to match the current inputs. A mismatch or absent lock fails closed without returning holdout metrics. This is process enforcement, not merely documentation, and prevents accidental tuning on holdout results.

### 4. Add terminology normalization as a separate lexical candidate

A small checked-in bidirectional terminology map normalizes declared English/Chinese terms and synonyms before invoking the same lexical candidate used by the baseline. It does not change the production tokenizer or index. The map is sorted, versioned, hashed, and included in candidate identity.

This candidate tests whether known cross-language terminology gaps can be closed without the roughly 135 MB model and measured memory/indexing costs of the first semantic candidate. It remains a benchmark candidate even if it wins; production adoption would require its own later scope.

### 5. Report paired deterministic bootstrap intervals

For each relevant query, the evaluator computes candidate-minus-baseline Recall@K and reciprocal-rank deltas. It resamples query pairs with replacement using a small deterministic seeded PRNG and records percentile confidence intervals, seed, and resample count. The default is 10,000 resamples.

Pairing preserves the fact that both candidates saw the same query and authorized corpus. A dependency-heavy statistical package was rejected because the calculation is small, auditable, and must run offline. The interval is decision evidence rather than a claim of population-level statistical significance.

### 6. Freeze both relevance and desktop-resource gates before holdout

The v2 manifest records minimum relevance deltas, confidence-interval rules, zero-tolerance safety gates, determinism tolerances, and maximum model bytes, peak RSS, latency, and index-build budgets. Development results may determine which candidate is locked but cannot change these gates after holdout is exposed.

This preserves the original insight that a relevance improvement is not automatically worth model size, memory, and startup cost on a desktop application.

### 7. Keep implementation evaluation-only and split cohesive files

All new code and fixtures stay under `kun/src/memory` evaluation surfaces. Production imports must not depend on v2 evaluation modules. Dataset contracts, uncertainty metrics, terminology normalization, and command orchestration are kept in separate cohesive files so each remains below the repository's 700-line limit.

## Risks / Trade-offs

- **Synthetic labels can encode author bias.** Mitigation: require rationales, explicit negatives, category quotas, strict reviewable files, and immutable hashes.
- **Forty holdout queries still have limited power.** Mitigation: report paired intervals and treat inconclusive intervals as no-go rather than lowering gates.
- **A terminology map can overfit known phrases.** Mitigation: tune mappings on development data only, hash the map, preserve unrelated queries unchanged, and measure category-specific holdout results.
- **Lock enforcement adds workflow friction.** Mitigation: make development, lock, and holdout commands explicit and produce actionable mismatch diagnostics without exposing results.
- **Bootstrap intervals can be misunderstood.** Mitigation: label the seed, method, resample count, sample size, and interpretation in generated reports.

## Migration Plan

1. Land the v2 specification, design, and task contract while retaining all v1 artifacts.
2. Add and validate the anonymous v2 fixtures, manifest, and strict loader.
3. Add paired uncertainty metrics, terminology-map evaluation, and development-grid execution.
4. Run development candidates and commit a lock artifact only after the candidate and gates are fixed.
5. Run holdout once through the lock, produce the v2 decision report, and retain production retrieval unchanged unless a later P2-B change is separately approved.

Rollback is deletion of the additive v2 evaluation artifacts and code; no user data or production migration is involved.

## Resolved Questions

- The existing E5 candidate remains the only semantic candidate in this change and may be tuned only on the v2 development split. Selecting or packaging another model is deferred.
- Every v2 label requires a documented rationale and a complete automated consistency check. An independent second human label pass is recommended before the final holdout run but is not required to implement the evaluation tooling.
