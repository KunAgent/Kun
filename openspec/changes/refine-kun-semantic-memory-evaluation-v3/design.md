## Context

The existing v1 and v2 evidence is frozen and records no-go outcomes for the E5 semantic candidate. The production baseline now includes the #1308 lexical abstention floor and must be recalculated before any v3 comparison. The current semantic candidate path applies semantic filtering before lexical RRF intersection, so lexical results cannot veto a semantically accepted record. This change evaluates alternative rejection architectures offline while preserving the production SQLite/FTS5 and filesystem paths.

## Goals / Non-Goals

**Goals:**

- Produce a versioned, deterministic v3 development/holdout evaluation with a reproducible go/no-go decision.
- Compare rejection architecture trade-offs while keeping `multilingual-e5-small-q8` fixed.
- Measure abstention, ranked quality, safety, uncertainty, cross-language zero-overlap recall, and desktop resource cost together.
- Make holdout access fail closed until candidate identity, parameters, hashes, and gates are locked.

**Non-Goals:**

- Do not change production semantic retrieval, lexical retrieval, canonical Memory JSON, or prompt injection.
- Do not add model binaries, model downloads, ONNX/runtime dependencies, vector indexes, feature flags, or packaged assets.
- Do not treat terminology mapping as production-approved or allow it to replace the primary candidate matrix.
- Do not alter v1/v2 frozen datasets or retroactively revise their decisions.

## Decisions

### Fixed model and candidate boundary

The v3 evaluator accepts one exact local E5 artifact identified by model, tokenizer, runtime, quantization, and file hashes. Query/passage prefixes, pooling, normalization, dimensions, and resource instrumentation are part of the candidate identity. Candidate wrappers receive the same authorized active records and query context, and return bounded selected ids plus trace metadata. No wrapper may read user Memory or make a network request.

Alternatives considered: evaluating a larger model would confound model quality with rejection architecture; changing the production candidate would violate P2-A's boundary. Both remain out of scope until a later decision.

### Four primary offline candidates

The matrix compares:

1. Existing semantic-gated-rrf behavior as the continuity control.
2. Lexical-veto semantic reranking, where the lexical foundation determines the admitted query/candidate window.
3. Lexical-veto plus a pre-registered score margin/gap rule.
4. The post-#1308 pure lexical foundation.

Terminology-map normalization is evaluated as a separately labeled exploratory control. It shares the same authorization and budget boundary but cannot be selected as the primary candidate solely because it improves recall.

The veto wrapper is evaluator-only. It must not be wired into `semantic-memory-vector-candidate.ts` or any production runtime path.

### Frozen dataset and stratification

The v3 manifest records records, queries, labels, rationales, category quotas, normalized-tokenizer version, split assignment, evaluation time, and content hashes. Development and holdout are disjoint at the query and near-duplicate level. Negative categories include no-evidence/authority, irrelevant, same-category near-miss, and scope/lifecycle cases. A dedicated positive category contains cross-language queries with zero normalized lexical overlap; its count and Recall@K are reported independently.

The zero-overlap rule is computed after the declared case, punctuation, CJK segmentation, stopword, and token normalization, before any terminology map. The rule and its minimum stratum count are frozen before candidate results are viewed.

### Pre-registered tuning and uncertainty

Before development execution, the change records the finite similarity, margin/gap, and fusion grid, the margin formula, ties, candidate selection order, and all safety/resource gates. In v3, the margin is the top admitted semantic score minus the second admitted semantic score; fewer than two admitted candidates pass, while a tie fails every positive margin. Every grid configuration is reported, including failures. Selection uses development only.

Quality deltas are paired by query id against the post-#1308 lexical baseline. Bootstrap resampling operates on complete queries, with a fixed seed, fixed resample count, and declared confidence interval method. The report includes both point estimates and lower bounds; the lower bound, not the point estimate alone, is used for the decision gate.

### Holdout lock

The evaluator creates a lock artifact only after development selection. The lock contains dataset hashes, model/candidate identity, thresholds, margin, fusion parameters, baseline identity, bootstrap settings, and gate version. Without a valid lock, holdout execution fails before emitting holdout labels, per-query results, or aggregate metrics. A holdout failure is a no-go and does not authorize a revised grid in the same version.

## Risks / Trade-offs

- **[Risk]** Lexical veto can remove genuine cross-language zero-overlap matches. → Keep that stratum first-class, report its Recall separately, and enforce a pre-registered loss gate.
- **[Risk]** A small dataset can make bootstrap intervals unstable. → Stratify the dataset, publish counts and intervals, and treat the lower bound as uncertainty evidence rather than a claim of population prevalence.
- **[Risk]** Multiple candidates or grid points can encourage post-hoc selection. → Freeze the finite grid and deterministic tie-break rule before development and report every configuration.
- **[Risk]** The evaluator may accidentally import production/user data. → Validate checked-in fixtures only by default, fail on local-data access, and keep wrappers outside production runtime composition.
- **[Risk]** Model/runtime drift can make a later rerun incomparable. → Record artifact, tokenizer, runtime, quantization, and preprocessing hashes in every report.
- **[Risk]** Archive synchronization can be mistaken for a production feature change. → Keep the v3 artifacts and evaluator-only code isolated, with no changes to production retrieval modules.
