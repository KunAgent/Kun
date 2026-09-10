## MODIFIED Requirements

### Requirement: Ranking signals are independent and deterministic

Kun SHALL combine normalized lexical relevance, scope/type affinity, temporal freshness, importance, and confidence as separate bounded features with stable tie-breaking. A lexical-only candidate SHALL be considered positively relevant only when its normalized lexical feature meets the versioned foundation relevance threshold; any explicit type-affinity candidate MAY remain relevant without lexical overlap.

#### Scenario: Weak lexical overlap is rejected

- **WHEN** an authorized active record has lexical relevance below the foundation threshold and no positive type affinity
- **THEN** it is excluded from the relevant ranking set and cannot consume the result or prompt budget

#### Scenario: Old but trusted fact competes with a recent weak inference

- **WHEN** two relevant memories differ in confidence and freshness
- **THEN** ranking evaluates both features independently and does not overwrite confidence with age decay

#### Scenario: Equal candidates tie

- **WHEN** candidates receive equal feature scores
- **THEN** ordering is stable by documented timestamp and id tie-breakers across repeated runs

#### Scenario: Ranking weights change

- **WHEN** maintainers tune a ranking weight
- **THEN** evaluation output records the weight set and compares retrieval metrics before the change is accepted

#### Scenario: Threshold behavior is shared across modes

- **WHEN** the same query and records are retrieved through SQLite FTS5 and filesystem fallback
- **THEN** both modes apply the same foundation relevance predicate and produce equivalent selected ids, subject to their recorded lexical feature values

#### Scenario: Type affinity remains available

- **WHEN** a query contains an explicit supported type hint and an authorized record matches that type
- **THEN** the record remains eligible even if lexical overlap is below the lexical threshold

### Requirement: Retrieval obeys record and prompt budgets

Turn retrieval SHALL select no more than the minimum of the caller limit and current `maxInjectedRecords`, and context assembly SHALL also enforce a deterministic prompt-size budget. Records rejected by the foundation relevance threshold SHALL be counted as irrelevant for bounded diagnostics and SHALL NOT be selected merely to fill the budget.

#### Scenario: No weak candidates are relevant

- **WHEN** all authorized active candidates are below the lexical threshold and have no type affinity
- **THEN** Kun injects no long-term memory block and reports an empty selected set

#### Scenario: Configuration lowers the limit

- **WHEN** `maxInjectedRecords` changes from eight to three
- **THEN** the next turn injects no more than three memories without rebuilding the repository

#### Scenario: Selected records are individually large

- **WHEN** relevant memory bodies would exceed the context budget
- **THEN** the assembler includes the highest-ranked bounded content, records exclusions/truncation, and does not exceed the budget

#### Scenario: No candidate is relevant

- **WHEN** every authorized active candidate has no positive foundation relevance
- **THEN** Kun injects no long-term memory block instead of filling the budget with unrelated records

### Requirement: Retrieval quality is evaluated reproducibly

The repository SHALL include anonymous deterministic retrieval fixtures and a scorer that compares the existing baseline with the hybrid foundation. The focused evaluation SHALL report the foundation threshold and its effect on ranked quality, abstention, explicit forbidden selections, scope/lifecycle safety, and both retrieval modes.

#### Scenario: Validate the lexical abstention gate

- **WHEN** the complete anonymous development split is evaluated with the foundation threshold
- **THEN** q033/q034 no longer select unrelated records, q035/q036 remain empty, and Recall@K, Precision@K, MRR, abstention, safety, and deterministic trace evidence are recorded together

#### Scenario: Run the retrieval evaluation

- **WHEN** the focused evaluation command executes
- **THEN** it reports Recall@K, Precision@K, reciprocal rank, scope leaks, selected context size, and latency for a fixed dataset

#### Scenario: Evaluate multilingual and safety cases

- **WHEN** the fixture suite runs
- **THEN** it covers English, Chinese, stale/confident records, replacement, inactive lifecycle, cross-workspace isolation, and prompt-injection content

#### Scenario: Production memory is present

- **WHEN** developers run the evaluation on a machine with real Kun data
- **THEN** the harness reads only checked-in anonymous fixtures unless the user explicitly invokes a separate local diagnostic mode
