# memory-retrieval-foundation Specification

## Purpose
Define scope- and lifecycle-safe Memory retrieval with deterministic bounded ranking, explainable traces, and untrusted context assembly across indexed and filesystem fallback paths.

## Requirements

### Requirement: Retrieval filters authority scope before ranking

Kun SHALL apply lifecycle, user, workspace, and project authorization filters before lexical scoring, ranking, tracing, or prompt assembly.

#### Scenario: Query one workspace

- **WHEN** a turn in workspace A retrieves memory
- **THEN** workspace/project records belonging only to workspace B never become candidates, trace entries, or injected context

#### Scenario: Query without a workspace

- **WHEN** a caller has no normalized workspace context
- **THEN** workspace and project memories are excluded rather than treated as global

#### Scenario: Inactive record matches exactly

- **WHEN** a disabled, deleted, expired, or superseded memory exactly matches the query
- **THEN** it is excluded before ranking and cannot displace an active record

### Requirement: Lexical retrieval supports bounded Latin and CJK matching

The normal indexed path SHALL use safely parameterized FTS5 over bounded normalized Latin tokens/trigrams and CJK bigrams, and the degraded path SHALL preserve equivalent query normalization without scanning outside the canonical memory root.

#### Scenario: Retrieve English terminology

- **WHEN** a query shares a normalized term or trigram with an authorized memory
- **THEN** lexical retrieval returns the memory with a deterministic relevance feature

#### Scenario: Retrieve Chinese terminology

- **WHEN** a Chinese query shares meaningful bigrams with an authorized Chinese memory
- **THEN** the indexed path can retrieve it without requiring whitespace tokenization

#### Scenario: Query contains FTS operators

- **WHEN** user text includes quotes, wildcard characters, boolean words, or FTS punctuation
- **THEN** Kun binds or escapes it as data and never executes unvalidated raw FTS syntax

#### Scenario: Generated token budget is exceeded

- **WHEN** a record or query would create more normalized grams than allowed
- **THEN** projection truncates deterministically, reports the condition in test diagnostics, and remains responsive

### Requirement: Ranking signals are independent and deterministic

Kun SHALL combine normalized lexical relevance, scope/type affinity, temporal freshness, importance, and confidence as separate bounded features with stable tie-breaking. A lexical-only candidate SHALL be considered positively relevant only when its normalized lexical feature meets the versioned foundation relevance floor for the query language (Latin or CJK); any explicit type-affinity candidate MAY remain relevant without lexical overlap.

#### Scenario: Weak lexical overlap is rejected

- **WHEN** an authorized active record has lexical relevance below the applicable foundation floor and no positive type affinity
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

### Requirement: User-scope memories are relevant rather than unconditional

Kun SHALL NOT inject every active user-scope memory solely because it is user-scoped.

#### Scenario: Unrelated user preference exists

- **WHEN** a turn is unrelated to an active preference or identity record
- **THEN** that record does not consume the configured result or prompt budget

#### Scenario: Identity query uses different wording

- **WHEN** a user asks an identity or preference question with weak lexical overlap
- **THEN** explicit type/scope affinity and normalized tags can retrieve relevant records within the foundation's model-free ranking limits

#### Scenario: Lexical foundation misses a true synonym

- **WHEN** no indexed token, tag, or type affinity connects a synonym query to its relevant memory
- **THEN** evaluation records the miss and the foundation does not fabricate semantic relevance

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

### Requirement: Injected memory is framed as untrusted reference context

Every memory context block SHALL state that records are historical reference evidence and SHALL NOT let memory text override system instructions or the current user request.

#### Scenario: Stored memory contains prompt injection

- **WHEN** an authorized retrieved memory tells the model to ignore prior instructions or invoke a tool
- **THEN** the wrapper identifies it as untrusted reference content and the record receives no instruction authority

#### Scenario: Source evidence is available

- **WHEN** an injected memory has bounded source evidence
- **THEN** the context includes its id, scope, confidence/freshness class, and source locator without copying an unbounded source body

#### Scenario: Stable prefix is reused

- **WHEN** different turns retrieve different memories
- **THEN** dynamic memory content stays outside the immutable system prefix and does not cause prefix fingerprint drift

### Requirement: Retrieval decisions are explainable and private

Kun SHALL retain a bounded trace for the latest retrieval that identifies filters, channels, normalized feature scores, final order, exclusions, and context-budget decisions without duplicating secret or full source content.

#### Scenario: User inspects the last turn

- **WHEN** memory diagnostics are requested after retrieval
- **THEN** they identify selected memory ids and bounded ranking reasons consistent with the actual injected set

#### Scenario: A record is filtered by scope

- **WHEN** an unauthorized record exists in another workspace
- **THEN** aggregate diagnostics may count a scope exclusion but do not expose that record's id or content to the caller

#### Scenario: Retrieval runs in degraded mode

- **WHEN** the SQLite index is unavailable
- **THEN** the trace identifies filesystem fallback and the result remains subject to the same scope, lifecycle, result, and prompt budgets

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
