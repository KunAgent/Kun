# semantic-memory-retrieval-evaluation Specification

## Purpose
Define a reproducible, privacy-preserving decision process that measures whether local semantic or hybrid Memory retrieval merits a separate production implementation.

## Requirements

### Requirement: Evaluation data is anonymous, deterministic, and frozen

The repository SHALL provide a strictly validated anonymous Memory corpus and labeled query set with explicit development and holdout splits, a fixed evaluation time, and immutable content hashes for each released dataset version. A v3 decision dataset SHALL record exact split counts, category quotas, a human-readable relevance rationale for every query, and a first-class stratum for positive cross-language queries with zero normalized lexical overlap.

The validator SHALL reject normalized duplicate or near-duplicate queries that cross the development/holdout boundary. Normalization SHALL use the frozen NFKC, case, punctuation, and token rules recorded in the manifest; a near-duplicate is a pair with token-set Jaccard similarity of at least `0.75`.

#### Scenario: Run the default evaluation

- **WHEN** a developer runs the semantic Memory evaluation without an explicit local-data option
- **THEN** it reads only checked-in synthetic records and queries and does not inspect canonical user Memory files

#### Scenario: Validate a malformed dataset

- **WHEN** a dataset contains an unknown field, duplicate id, invalid Memory field, unresolved expected or forbidden id, conflicting label, missing rationale, invalid category quota, missing zero-overlap positive stratum, or unsupported schema version
- **THEN** evaluation rejects the complete dataset before executing any retrieval candidate

#### Scenario: Protect the holdout split

- **WHEN** candidate choice, model choice, thresholds, terminology mappings, margin values, or fusion parameters are still being tuned
- **THEN** only development queries are used and holdout labels and result metrics remain outside the tuning result

#### Scenario: Change a frozen dataset

- **WHEN** any frozen record, query, label, rationale, threshold, category quota, zero-overlap stratum, or split changes
- **THEN** the dataset or decision version changes and new hashes and baselines are recorded before candidate results are accepted

#### Scenario: Freeze a decision-grade dataset

- **WHEN** a v3 dataset is accepted for a go/no-go decision
- **THEN** its manifest records exact development and holdout counts, category distribution, zero-overlap positive counts, fixed evaluation time, and content hashes

### Requirement: Retrieval candidates are compared through one authorization boundary

The evaluator SHALL apply the existing scope and lifecycle rules before candidate-specific lexical or semantic processing and SHALL compare candidates with the same authorized corpus, evaluation time, result limit, and prompt-character budget.

#### Scenario: Another workspace contains a semantic match

- **WHEN** a query in workspace A is semantically similar to a record authorized only for workspace B
- **THEN** that record is excluded before candidate-specific processing and cannot appear in scores, selected ids, traces, or context

#### Scenario: An inactive record is the strongest match

- **WHEN** a disabled, deleted, expired, future-valid, or superseded record best matches a query
- **THEN** it is excluded before candidate-specific processing and cannot displace an active authorized record

#### Scenario: Compare lexical and hybrid candidates

- **WHEN** two candidates are evaluated on one dataset version
- **THEN** both receive the same filtered input records, K, prompt budget, and deterministic query order

### Requirement: Ranked quality and abstention are reported separately

The evaluator SHALL report Recall@K, Precision@K, and mean reciprocal rank only across queries with non-empty expected sets, SHALL report empty-result accuracy and false-positive selections separately, and SHALL report paired per-query deltas against the post-#1308 lexical foundation baseline with deterministic bootstrap confidence intervals and lower-bound gate results.

#### Scenario: Query expects no result

- **WHEN** a candidate returns no records for a query whose expected set is empty
- **THEN** abstention is counted as correct without adding a perfect Recall@K or reciprocal-rank sample

#### Scenario: Query expects multiple records

- **WHEN** a labeled query has more than one expected record
- **THEN** Recall@K reflects the fraction found while reciprocal rank reflects the first relevant result

#### Scenario: Inspect result breakdowns

- **WHEN** an evaluation completes
- **THEN** its report includes overall, development, holdout, language, category, and zero-overlap-positive breakdowns plus per-query selected ids, paired baseline deltas, bootstrap lower bounds, and bounded timing

#### Scenario: Quantify uncertainty

- **WHEN** a locked candidate is compared with the frozen lexical baseline
- **THEN** the report includes query-level paired bootstrap confidence intervals, the lower-bound calculation, the random seed, and the resample count for Recall@K and reciprocal-rank deltas

### Requirement: Authorization safety negatives are complete and decision-blocking

For each query, the evaluator SHALL report explicit relevance hard negatives separately, derive every corpus record excluded by scope or lifecycle as an authorization negative, detect unknown selections, authority changes, network attempts, and fallback mismatches, and treat any authorization-safety violation as an automatic no-go.

#### Scenario: Fixture omits an out-of-scope id from forbidden ids

- **WHEN** an out-of-scope or inactive record is not manually listed as a hard negative
- **THEN** the evaluator still derives it as forbidden and reports its selection as a safety failure

#### Scenario: Same-scope relevance distractor is selected

- **WHEN** a candidate selects an authorized active record listed as an explicit relevance hard negative
- **THEN** the evaluator reports the quality error without misclassifying it as a scope or lifecycle leak

#### Scenario: Candidate changes Memory authority

- **WHEN** a candidate result represents a fixture record with authority other than `reference`
- **THEN** evaluation records an authority violation and the decision is no-go

#### Scenario: Semantic capability is unavailable

- **WHEN** candidate model bytes are missing, corrupt, unsupported, or fail to initialize
- **THEN** the evaluated fallback result matches the existing lexical/filesystem behavior and no safety boundary is relaxed

### Requirement: Candidate identity, offline behavior, and resource cost are reproducible

Every evaluated semantic candidate SHALL record its exact model file hash, tokenizer hash, query/passage prefix convention, pooling and normalization rules, dimensions, quantization, runtime identity, license, fusion parameters, supported platforms, and measured desktop resource costs, and SHALL execute without a network request.

#### Scenario: Run an offline candidate

- **WHEN** the candidate benchmark executes with network access denied or instrumented to fail
- **THEN** it completes from local artifacts or reports an explicit unsupported result without attempting a remote embedding request

#### Scenario: Record performance evidence

- **WHEN** a candidate completes development or holdout evaluation
- **THEN** the report includes cold readiness, warm query p50 and p95, fixture and deterministic 10,000-record index build time, incremental projection time, model bytes, index bytes, and peak process RSS

#### Scenario: Repeat a locked candidate

- **WHEN** the frozen full evaluation is run three times with identical candidate metadata and parameters
- **THEN** selected ids are identical and numeric scores remain within the declared tolerance

### Requirement: Progression uses pre-registered go/no-go gates

The P2-A v3 decision SHALL compare locked candidates with the post-#1308 lexical foundation baseline using pre-registered relevance thresholds, paired-bootstrap lower bounds, abstention and safety rules, resource budgets, and deterministic selection rules. It SHALL NOT authorize production semantic retrieval unless all safety, relevance, uncertainty, determinism, and resource gates pass. Candidate selection and parameter tuning SHALL use development results only.

#### Scenario: Candidate improves relevance but leaks scope

- **WHEN** Recall@K improves while any scope or lifecycle leak occurs
- **THEN** the final decision is no-go regardless of the relevance gain

#### Scenario: Candidate misses a relevance or desktop budget

- **WHEN** a candidate fails any pre-registered required relevance, bootstrap lower-bound, abstention, latency, size, build-time, or memory threshold
- **THEN** the report names the failed threshold and production integration remains unapproved

#### Scenario: Candidate selection is not locked

- **WHEN** a candidate or parameter set has not been selected and recorded from development-only evidence
- **THEN** the evaluator refuses to produce a holdout decision report

#### Scenario: Candidate passes every P2-A gate

- **WHEN** one locked candidate passes every frozen gate and the evidence is reproducible
- **THEN** P2-A records a go recommendation but production projection and runtime integration still require a separate P2-B OpenSpec scope

### Requirement: P2-A cannot change production retrieval

P2-A SHALL NOT change canonical Memory JSON, production SQLite/FTS5 or filesystem retrieval, turn injection, renderer/Main/Manager/HTTP behavior, application settings, model download, or packaged runtime dependencies.

#### Scenario: Ship the P2-A change

- **WHEN** the P2-A artifacts, fixtures, evaluator, and decision report are merged
- **THEN** a normal Kun run behaves exactly as before unless a developer explicitly invokes the evaluation tooling

#### Scenario: P2-A concludes no-go

- **WHEN** no candidate passes every gate
- **THEN** the current lexical/filesystem implementation remains the supported production path without a dormant vector feature

### Requirement: Development tuning is bounded and holdout-blind

The evaluator SHALL support a pre-declared finite grid of similarity thresholds, margin/gap values, and fusion weights for development-only comparison, SHALL record every evaluated configuration, SHALL define the margin formula and tie behavior, and SHALL prevent holdout scoring until one candidate configuration and all decision thresholds are locked.

#### Scenario: Tune a candidate on development data

- **WHEN** a developer runs the declared parameter grid
- **THEN** every configuration is evaluated against only development queries using the same authorized corpus, K, prompt budget, and deterministic ordering

#### Scenario: Attempt holdout evaluation before locking

- **WHEN** no valid lock artifact identifies one candidate configuration and the frozen decision gates
- **THEN** holdout evaluation fails without emitting holdout labels, per-query results, or aggregate metrics

#### Scenario: Repeat a development grid

- **WHEN** the same dataset, grid, candidate artifacts, and seed are evaluated again
- **THEN** the configuration order, selected ids, scores, and selected configuration are reproducible within the declared tolerance

### Requirement: A low-cost lexical enhancement is exploratory

The evaluator SHALL keep deterministic, checked-in terminology-map normalization as a separately labeled exploratory candidate and SHALL compare it under the same authorization, ranking, K, prompt-budget, and resource rules as primary candidates. The terminology-map candidate SHALL NOT be selected as the primary candidate or authorize production changes by itself.

#### Scenario: Compare terminology normalization with embeddings

- **WHEN** the development evaluation includes both the terminology-map candidate and primary lexical or semantic candidates
- **THEN** the terminology-map result is reported independently against the unmodified lexical baseline and cannot be selected as the primary candidate

#### Scenario: Change a terminology mapping

- **WHEN** any checked-in mapping entry changes
- **THEN** the exploratory candidate identity or version and artifact hash change before new results are accepted

#### Scenario: Normalize an unrelated query

- **WHEN** no declared terminology entry matches a query token or phrase
- **THEN** the exploratory candidate submits the original query to lexical retrieval unchanged

### Requirement: Candidate rejection architectures are compared offline

The evaluator SHALL compare the current semantic-gated fusion, a lexical-veto semantic reranker, a lexical-veto semantic reranker with the pre-registered margin/gap rule, and the post-#1308 pure lexical foundation using the same authorization boundary, corpus, K, prompt budget, and deterministic query order. These candidates SHALL remain evaluator-only.

#### Scenario: Lexical veto protects abstention

- **WHEN** the lexical foundation rejects a query under the declared gate
- **THEN** the lexical-veto candidates return no semantic result for that query, and the report records any loss on zero-overlap positive queries separately

#### Scenario: Semantic reranking preserves the allowed window

- **WHEN** the lexical foundation admits a query and semantic scores are available
- **THEN** the lexical-veto candidates rerank only the admitted window and cannot introduce a record rejected by the lexical gate

#### Scenario: Terminology mapping is exploratory

- **WHEN** the development run includes a terminology-map candidate
- **THEN** it is reported independently from the four primary candidates and cannot authorize production changes by itself

### Requirement: Cross-language zero-overlap positives are first-class

The evaluator SHALL identify positive queries whose expected records have zero normalized lexical overlap with the query under the declared tokenizer and normalization rules, and SHALL report their Recall@K for every candidate independently from aggregate quality and abstention.

#### Scenario: Candidate preserves cross-language recall

- **WHEN** a candidate retrieves an expected record for a zero-overlap cross-language query
- **THEN** the result contributes to the dedicated zero-overlap Recall@K report and the overall relevance metrics

#### Scenario: Candidate removes cross-language recall

- **WHEN** a lexical-veto candidate returns no expected record for a zero-overlap cross-language query
- **THEN** the report records the miss as a candidate trade-off and applies the pre-registered stratum gate
