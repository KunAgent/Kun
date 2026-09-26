## Purpose

Define a reproducible and privacy-preserving decision process for testing whether explicit Memory feedback can safely resolve close lexical rankings without changing production behavior.

## ADDED Requirements

### Requirement: Decision data is anonymous, stratified, and frozen

The evaluator SHALL use a strictly validated synthetic Memory, feedback, and query dataset with separate development and holdout splits. The versioned manifest SHALL record exact split counts, stratum quotas, fixed evaluation time, normalization rules, human-readable relevance and pair-preference rationales, and SHA-256 hashes for every decision artifact. It SHALL include near-tie positive cases, wide-gap controls, no-feedback controls, high-frequency-unconfirmed controls, no-result queries, and scope/lifecycle hard negatives.

#### Scenario: Run the default evaluation

- **WHEN** a developer runs the feedback tie-breaker evaluation without an explicit fixture override
- **THEN** it reads only checked-in synthetic data and does not inspect canonical user Memory or feedback files

#### Scenario: Validate a malformed dataset

- **WHEN** a fixture contains an unknown field, duplicate id, invalid Memory or feedback event, unresolved target, conflicting label, missing rationale, invalid split quota, or unsupported version
- **THEN** the evaluator rejects the complete dataset before scoring a candidate

#### Scenario: Modify a frozen artifact

- **WHEN** a record, event, query, label, rationale, split, candidate rule, gate, or normalization rule changes
- **THEN** the decision version and affected hashes change before new evidence can be accepted

### Requirement: Near-tie boundaries are derived and pre-registered

The decision plan SHALL define near-tie from lexical foundation scores through a finite, deterministic candidate grid selected on development data only. The plan SHALL record the gap formula, boundary inclusivity, grouping behavior, maximum reorder window, stable tie order, and derivation evidence before holdout evaluation. No boundary or effect limit SHALL be treated as proven merely because it was suggested in planning.

#### Scenario: Compare a near-tie pair

- **WHEN** two authorized active candidates fall inside a declared near-tie boundary
- **THEN** an evaluator candidate may reorder only those admitted candidates according to its pre-registered explicit-feedback rule

#### Scenario: Compare a wide-gap pair

- **WHEN** the foundation-score gap exceeds the locked near-tie boundary
- **THEN** feedback cannot reverse their foundation order

#### Scenario: Encounter an exact boundary

- **WHEN** a score gap equals a declared boundary
- **THEN** every repeated run applies the recorded inclusive or exclusive rule and produces the same order

### Requirement: Explicit evidence is bounded and retrieval frequency is shadow-only

Candidate scoring SHALL distinguish explicit confirmation, explicit correction of the active replacement, retrieval frequency, and absence of feedback. Retrieval count, last-retrieved time, or repeated exposure SHALL be reported for analysis but SHALL NOT affect candidate admission, ordering, selection, or decision gates. Confirmation and correction evidence SHALL affect only candidates already admitted to the same near-tie window after scope and lifecycle filtering.

#### Scenario: Compare a frequently retrieved unconfirmed record

- **WHEN** a near-tie record has many retrieval impressions but no explicit confirmation or correction
- **THEN** its frequency is visible in the trace but cannot improve its rank

#### Scenario: Prefer an explicitly confirmed record inside a near tie

- **WHEN** the labeled preferred record is explicitly confirmed and falls inside the locked near-tie window
- **THEN** a confirmation-aware candidate may rank it ahead according to the locked deterministic rule

#### Scenario: Exclude a superseded record with historical feedback

- **WHEN** a superseded record has stronger historical feedback than its active replacement
- **THEN** lifecycle filtering excludes the old record before feedback evaluation and feedback cannot restore it

### Requirement: Authorization and abstention precede feedback evaluation

The evaluator SHALL apply the production scope, authority, lifecycle, positive-relevance, result-count, and prompt-budget boundaries before feedback-specific processing. A feedback candidate SHALL NOT introduce a record rejected by the lexical foundation, fill an empty result, cross scope, change authority, or reactivate a disabled, deleted, expired, future-valid, or superseded record.

#### Scenario: Foundation retrieval abstains

- **WHEN** the lexical foundation admits no positively relevant record
- **THEN** every feedback candidate returns no result regardless of feedback history

#### Scenario: Out-of-scope record has stronger feedback

- **WHEN** an unauthorized record has more confirmation or correction evidence than all authorized records
- **THEN** it is absent from scores, selected ids, traces, and context projections

#### Scenario: Feedback would exceed a prompt budget

- **WHEN** a reordered candidate set would exceed the shared result or character budget
- **THEN** evaluation applies the unchanged production budget and reports only the records that fit

### Requirement: Local benefit and global non-regression are evaluated separately

The report SHALL measure human-labeled near-tie pair-ordering accuracy separately from Recall@K, Precision@K, mean reciprocal rank, abstention accuracy, explicit hard-negative selections, and authorization-safety violations. It SHALL publish per-case paired deltas against the unchanged post-#1308 lexical foundation and deterministic bootstrap confidence intervals using the pre-registered seed, resample count, confidence level, and gate thresholds.

#### Scenario: Improve a labeled near-tie pair

- **WHEN** a candidate correctly reverses a foundation misordering inside the declared near-tie window
- **THEN** the report counts the local ordering improvement and independently reports its effect on global metrics

#### Scenario: Improve local order but regress global quality

- **WHEN** near-tie pair accuracy improves while a required global non-regression, abstention, or safety gate fails
- **THEN** the final decision is no-go

#### Scenario: Report uncertainty

- **WHEN** development or locked holdout evaluation completes
- **THEN** the report includes point estimates, paired confidence intervals, lower-bound gate results, and the exact evaluated case count for every decision metric

### Requirement: Development tuning is bounded and holdout-blind

The evaluator SHALL run only the pre-declared finite candidate grid on development data, record every result, select at most one candidate using the locked selection rule, and persist a lock artifact containing the chosen candidate, decision gates, artifact hashes, and evaluator identity. Holdout evaluation SHALL fail until that lock is valid and SHALL produce a final decision at most once for the decision version.

#### Scenario: Tune the candidate grid

- **WHEN** a developer runs development evaluation
- **THEN** every declared boundary and explicit-signal combination is evaluated in deterministic order without exposing holdout metrics

#### Scenario: Attempt holdout before locking

- **WHEN** the candidate, gates, hashes, or evaluator identity are not locked
- **THEN** holdout evaluation fails without emitting holdout labels, per-case results, or aggregate metrics

#### Scenario: Attempt to retune after holdout

- **WHEN** a holdout decision exists and any candidate parameter or gate changes
- **THEN** the evaluator requires a new decision version rather than overwriting the frozen evidence

#### Scenario: Report flags contradict metrics

- **WHEN** a development report's gate flags or candidate grid disagree with its metrics and pre-registered plan
- **THEN** candidate lock creation fails rather than trusting a reported passing flag

#### Scenario: Concurrent or interrupted holdout write

- **WHEN** two executions use the same decision output directory or a previous execution was interrupted after reserving its evidence file
- **THEN** exclusive creation permits at most one scoring attempt and preserves incomplete evidence for review instead of automatically retrying

#### Scenario: Final output changes locked development evidence

- **WHEN** a holdout callback returns another candidate identity, changed development metrics, or a decision inconsistent with its gates
- **THEN** the writer rejects the payload and retains the consumed attempt without publishing it as valid evidence

### Requirement: Evaluation is deterministic, private, and resource-bounded

Candidate identity SHALL include the evaluator version, foundation version, near-tie rule, signal rule, normalization, fixed evaluation time, and artifact hashes. Repeated runs SHALL produce identical selected ids and scores within the declared tolerance, SHALL perform no network request, SHALL omit query text, Memory content, source excerpts, credentials, and machine paths from bounded traces, and SHALL enforce pre-registered runtime and trace-size ceilings.

#### Scenario: Repeat a locked evaluation

- **WHEN** the same locked artifacts and runtime inputs are evaluated again
- **THEN** candidate order, selected ids, metrics, and decision results are reproducible within the declared tolerance

#### Scenario: Instrument network access

- **WHEN** network access is denied or instrumented to fail during evaluation
- **THEN** the evaluator completes from local synthetic artifacts without attempting a network request

#### Scenario: Exceed a resource ceiling

- **WHEN** evaluation time, trace count, or serialized evidence exceeds a pre-registered bound
- **THEN** the affected candidate fails the resource gate and cannot receive a go recommendation

### Requirement: A decision cannot change production ranking

This change SHALL remain evaluator-only. A go result SHALL authorize only a separate production-integration proposal, while a no-go result SHALL preserve the P3-A feedback infrastructure and unchanged lexical production ranking. Neither outcome SHALL add a dormant ranking flag, import evaluator code from a production module, or mutate canonical Memory and feedback data.

#### Scenario: Evaluation concludes go

- **WHEN** one locked candidate passes every local-benefit, global non-regression, uncertainty, safety, determinism, privacy, and resource gate
- **THEN** the report records a go recommendation and production behavior remains unchanged pending a separate OpenSpec change

#### Scenario: Evaluation concludes no-go

- **WHEN** no candidate passes every pre-registered gate
- **THEN** the report records no-go, retains P3-A confirm/correct/audit behavior, and leaves lexical ranking unchanged
