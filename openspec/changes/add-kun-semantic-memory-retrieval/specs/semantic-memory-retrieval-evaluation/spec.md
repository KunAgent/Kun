## Purpose

Define a reproducible, privacy-preserving decision process that measures whether local semantic or hybrid Memory retrieval merits a separate production implementation.

## ADDED Requirements

### Requirement: Evaluation data is anonymous, deterministic, and frozen

The repository SHALL provide a strictly validated anonymous Memory corpus and labeled query set with explicit development and holdout splits, a fixed evaluation time, and immutable content hashes for each released dataset version.

#### Scenario: Run the default evaluation

- **WHEN** a developer runs the semantic Memory evaluation without an explicit local-data option
- **THEN** it reads only checked-in synthetic records and queries and does not inspect canonical user Memory files

#### Scenario: Validate a malformed dataset

- **WHEN** a dataset contains an unknown field, duplicate id, invalid Memory field, unresolved expected or forbidden id, conflicting label, or unsupported schema version
- **THEN** evaluation rejects the complete dataset before executing any retrieval candidate

#### Scenario: Protect the holdout split

- **WHEN** candidate choice, model choice, thresholds, or fusion parameters are still being tuned
- **THEN** only development queries are used and the holdout labels remain outside the tuning result

#### Scenario: Change a frozen dataset

- **WHEN** any frozen record, query, label, threshold, or split changes
- **THEN** the dataset or decision version changes and new hashes and baselines are recorded before candidate results are accepted

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

The evaluator SHALL report Recall@K, Precision@K, and mean reciprocal rank only across queries with non-empty expected sets, and SHALL report empty-result accuracy and false-positive selections separately.

#### Scenario: Query expects no result

- **WHEN** a candidate returns no records for a query whose expected set is empty
- **THEN** abstention is counted as correct without adding a perfect Recall@K or reciprocal-rank sample

#### Scenario: Query expects multiple records

- **WHEN** a labeled query has more than one expected record
- **THEN** Recall@K reflects the fraction found while reciprocal rank reflects the first relevant result

#### Scenario: Inspect result breakdowns

- **WHEN** an evaluation completes
- **THEN** its report includes overall, development, holdout, language, and category breakdowns plus per-query selected ids and bounded timing

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

Every evaluated semantic candidate SHALL record its model and runtime identity, version, license, artifact hash, dimensions, normalization and fusion parameters, supported platforms, and measured desktop resource costs, and SHALL execute without a network request.

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

The P2-A decision SHALL compare a locked candidate with the frozen lexical baseline using thresholds recorded before holdout execution, and SHALL NOT authorize production semantic retrieval unless all safety, relevance, determinism, and resource gates pass.

#### Scenario: Candidate improves relevance but leaks scope

- **WHEN** Recall@K improves while any scope or lifecycle leak occurs
- **THEN** the final decision is no-go regardless of the relevance gain

#### Scenario: Candidate misses a relevance or desktop budget

- **WHEN** a candidate fails any pre-registered required relevance, latency, size, build-time, or memory threshold
- **THEN** the report names the failed threshold and production integration remains unapproved

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
