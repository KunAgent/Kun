## Context

See `proposal.md` for motivation. P3-A provides an opt-in append-only feedback ledger, rebuildable aggregates, explicit confirmation/correction, versioned supersession, and an evaluator-only v1 additive candidate. That candidate added as much as `0.25` to the foundation score and correctly produced a holdout no-go because it did not improve the global relevance lower bounds. Production retrieval still uses the post-#1308 lexical/FTS5 foundation and does not read feedback aggregates.

P3-B must test a narrower hypothesis without rewriting the frozen v1 artifacts: explicit user evidence may be useful only when the lexical foundation is already uncertain between authorized active candidates. The other agent's importer work is isolated in a separate worktree and does not share this change's files.

## Goals / Non-Goals

**Goals:**

- Define and evaluate a bounded, deterministic near-tie reranking family.
- Derive candidate boundaries from development foundation-score distributions rather than adopting an unsupported percentage.
- Measure local pair-ordering benefit and global non-regression as distinct claims.
- Preserve holdout blindness, privacy, authorization, abstention, lifecycle, determinism, and resource limits.
- Produce a reproducible go/no-go artifact that can stand even when the answer is no-go.

**Non-Goals:**

- Changing production retrieval, prompt injection, settings, Manager/API/UI behavior, or packaged dependencies.
- Reopening embedding retrieval or adding a vector model.
- Treating retrieval frequency, freshness, confidence, or importance as user confirmation.
- Replacing the correction/supersession lifecycle path with a second relation mechanism.
- Designing P4 relation suggestions or Working Context in this change.
- Re-evaluating the deterministic `decideMemoryCandidate()` dispatch logic.

## Decisions

### 1. Add a new evaluation capability instead of modifying P3-A

Create `memory-feedback-ranking-evaluation` as a separate capability. P3-A's contract already requires a separately versioned passed decision before production ranking can use feedback, so P3-B supplies that decision process without changing feedback collection or canonical Memory behavior.

Modifying the not-yet-archived `memory-feedback-evolution` capability was rejected because it would couple this preparation branch to P3-A closeout and obscure the fact that no production behavior is being added.

### 2. Use a lexical admission boundary followed by a near-tie window

Run the existing foundation authorization, lifecycle, positive-relevance, result-count, and prompt-budget logic first. The evaluator then groups only admitted candidates whose foundation-score gaps satisfy one declared near-tie rule. Feedback can reorder within that group but cannot add a record, fill an abstention, cross a budget, or move a wide-gap candidate.

An unconstrained additive score was rejected because v1 could add `0.25` regardless of foundation uncertainty. A percentage such as 5% or 10% is not adopted as a requirement; it may appear only as a labeled sensitivity-analysis point if derived and frozen before holdout.

### 3. Derive a small boundary grid from baseline-only development evidence

Before running feedback candidates, compute adjacent foundation-score gaps and labeled foundation errors on the development split. A versioned calibration report applies a fixed derivation procedure to produce a small finite grid, for example selected empirical gap quantiles plus an exact-tie control and a no-rerank control. The report records all source gaps, the procedure, resulting values, inclusivity, and maximum window size.

The grid is allowed to use development labels because development is the declared tuning split. Directly choosing a boundary after inspecting candidate success, searching arbitrary values, or using holdout gaps is rejected as post-hoc tuning.

### 4. Compare evidence rules without numeric popularity weights

The primary candidate family uses deterministic evidence classes inside a near-tie group:

1. confirmation-aware: explicit confirmation outranks neutral evidence;
2. confirmation-and-correction-aware: explicit confirmation and the active replacement identified by explicit correction are compared through a pre-declared evidence precedence;
3. foundation-only controls at every boundary.

Within the same evidence class, preserve foundation score and then stable Memory id order. Retrieval frequency and last-retrieved time are emitted only as shadow features and never participate in the comparator or grid-selection rule.

Numeric additive weights were rejected for this decision because they obscure the actual swap boundary and invite the same broad influence tested by v1. The development evidence may eliminate an evidence rule, but it cannot invent a new rule outside the pre-registration.

### 5. Build a new anonymous fixture version with explicit strata

Do not extend or overwrite the four-case P3-A v1 fixture. Add a new schema with synthetic Memory records, valid feedback events, queries, preferred/unpreferred pairs, expected sets, explicit hard negatives, and rationale fields. The manifest fixes exact counts before candidate scoring.

Required strata are:

- a confirmed relevant record should beat a close unconfirmed distractor;
- an active corrected replacement should beat a close stale or neutral distractor;
- high retrieval frequency without explicit evidence must not improve rank;
- no-feedback cases must preserve foundation order;
- wide-gap cases must preserve foundation order even when the lower record is confirmed;
- no-result queries must remain empty;
- out-of-scope and inactive records remain invisible despite stronger feedback;
- cases where feedback points at the wrong relevant record expose false-positive trade-offs.

Normalized duplicate and near-duplicate cases cannot cross development and holdout. A fixture validator rejects invalid feedback identity, scope, lifecycle, labels, targets, quotas, or hashes before any score is calculated.

### 6. Separate local-benefit gates from global non-regression gates

The primary benefit metric is labeled pair-ordering accuracy inside eligible near-tie cases. The candidate must improve this metric under a pre-registered point estimate and paired-bootstrap lower-bound gate. Global Recall@K, Precision@K, MRR, abstention, explicit forbidden selections, and authorization violations are separate non-regression or zero-tolerance gates.

This avoids demanding that a tie-breaker drive a large global Recall/MRR gain while still preventing an easy pass based only on hand-picked local examples. Exact deltas, confidence bounds, resamples, seed, and tolerances belong to the versioned decision plan and are frozen before holdout.

### 7. Use a two-stage lock and one holdout decision

Development execution has three ordered steps:

1. create the baseline-only calibration report and finite boundary grid;
2. evaluate every declared evidence-rule and boundary combination;
3. apply a deterministic selection rule and write a lock artifact.

The lock includes fixture and manifest hashes, selected candidate, gates, runtime/evaluator identity, seed, and resource ceilings. Holdout execution refuses to run without the lock and writes one immutable evidence file. Any later parameter or label change requires a new decision version.

### 8. Keep evaluator dependencies one-way

Offline modules may import production contracts and pure foundation-ranking helpers. Production Memory, server, Manager, renderer, and runtime modules cannot import the evaluator. Tests enforce this boundary through import checks and production-parity assertions.

No network, model file, native dependency, or user data directory is required. Traces use case and Memory ids plus numeric features; human-readable content remains in the checked-in fixture rather than duplicated into evidence.

## Risks / Trade-offs

- **Near-tie boundaries can overfit a small development set** → freeze the derivation procedure, include wide-gap and no-rerank controls, report all configurations, and require paired holdout confidence gates.
- **Human pair labels can encode author preference** → require per-case rationales, independent review of ambiguous cases, explicit disagreement recording, and separate safety labels.
- **Confirmation can reinforce an old but still active fact** → lifecycle filtering remains first, corrected old versions are excluded, and feedback cannot override wide foundation gaps.
- **Correction evidence can be double-counted with lifecycle** → trace lifecycle admission separately and compare confirmation-only with confirmation-plus-correction candidates rather than assuming correction must help.
- **A narrow local metric can hide broad regressions** → require global non-regression, abstention, hard-negative, and zero-leak gates in addition to local benefit.
- **The branch is temporarily based on unmerged P3-A** → keep it preparation-only, open no stacked PR, and rebase onto `develop` after #1324 and its closeout are merged.

## Migration Plan

1. Add and validate the new anonymous fixture schema, manifest, and baseline-only calibration report.
2. Add the evaluator candidate grid, deterministic lock artifact, and development-only reports.
3. Review and freeze the selected candidate and every gate before enabling the holdout command.
4. Run holdout once and publish the immutable go/no-go evidence.
5. Merge evaluation artifacts without production imports or runtime changes. If the result is go, create a separate production-integration OpenSpec change; if no-go, stop without rollback because production was never changed.
