## Purpose

Define a privacy-bounded and auditable feedback history that distinguishes Memory injection from explicit user confirmation and correction, supports versioned evolution, and permits offline ranking evaluation without granting feedback new authority.

## ADDED Requirements

### Requirement: Feedback events are strict, private, and idempotent

Kun SHALL validate versioned feedback events with a unique event id, event kind, target Memory id, occurrence time, and bounded turn identity when applicable. Feedback events SHALL NOT persist query text, Memory content, model output, credentials, source excerpts, or local filesystem paths. Replaying an event id with the same payload SHALL be a no-op, while replaying it with a different payload SHALL fail closed.

#### Scenario: Record an injected memory

- **WHEN** an authorized active Memory is selected and assembled into a model turn context
- **THEN** Kun may record one `retrieved` event containing bounded identity metadata but no query or Memory body

#### Scenario: Replay an event after reconnect

- **WHEN** Manager or runtime replay submits an already persisted event id with the same payload
- **THEN** the ledger retains one event and aggregate counts do not increase

#### Scenario: Reuse an event id with different data

- **WHEN** a caller submits an existing event id with a different kind, Memory id, time, or version link
- **THEN** validation rejects the conflicting event without modifying durable feedback state

### Requirement: Retrieval impressions and user confirmation remain distinct

Kun SHALL treat a retrieval impression only as evidence that a Memory was included in generated context. It SHALL NOT treat retrieval, model continuation, repeated ranking, or UI search as user confirmation. A confirmation or correction SHALL require an explicit user action against an authorized visible Memory.

#### Scenario: Search the Memory settings list

- **WHEN** a user searches, filters, previews, or opens a Memory without confirming it
- **THEN** no retrieval, confirmation, or correction feedback event is recorded

#### Scenario: A turn receives Memory context

- **WHEN** a Memory reference block is assembled for a turn and the model request proceeds
- **THEN** the event contributes only to retrieval usage and does not increase confirmation or correctness signals

#### Scenario: User explicitly confirms a Memory

- **WHEN** the user invokes confirmation for an active Memory visible in the current scope
- **THEN** Kun records one explicit confirmation event attributable to that user action

### Requirement: Feedback persistence is recoverable and independently diagnosable

Kun SHALL persist feedback through one Manager-owned append-only ledger per data root, SHALL serialize local and remote mutations through the owning process, and SHALL expose bounded diagnostics for malformed tails, duplicate events, projection state, and write failures. Feedback corruption or unavailability SHALL NOT corrupt canonical Memory records.

#### Scenario: Process exits during an append

- **WHEN** the feedback ledger ends with a partial or malformed event after restart
- **THEN** Kun preserves valid prior events, excludes the malformed tail from aggregation, and reports a bounded degraded reason

#### Scenario: Multiple runtimes record the same event

- **WHEN** GUI, TUI, or reconnected runtime clients submit the same stable event through Manager
- **THEN** the Manager-owned ledger commits it at most once and all clients observe the same aggregate state

#### Scenario: Feedback storage is unavailable

- **WHEN** the ledger cannot open, append, validate, or rebuild its projection
- **THEN** diagnostics report feedback degradation without disabling canonical Memory CRUD or retrieval

### Requirement: Usage aggregates are rebuildable and do not mutate Memory freshness

Kun SHALL derive bounded per-Memory retrieval, confirmation, and correction counts and last-event timestamps from validated feedback events. Aggregate state SHALL be a rebuildable projection and SHALL NOT update canonical Memory content, `updatedAt`, `observedAt`, confidence, importance, or freshness.

#### Scenario: A memory is injected repeatedly

- **WHEN** multiple distinct retrieval events are recorded for one Memory
- **THEN** its retrieval count and last-retrieved time advance while its canonical timestamps and ranking features remain unchanged

#### Scenario: Rebuild feedback aggregates

- **WHEN** an aggregate projection is missing, stale, or corrupt while valid feedback events remain
- **THEN** Kun rebuilds equivalent counts and timestamps without rewriting Memory records

#### Scenario: An inactive memory has historical feedback

- **WHEN** a Memory becomes disabled, deleted, expired, or superseded
- **THEN** its feedback remains auditable but cannot restore lifecycle eligibility or make the record injectable

### Requirement: Corrections create auditable Memory versions

An explicit correction SHALL create a new canonical Memory in the same scope, link it to the prior record with `supersedes`, mark the prior record superseded through the canonical mutation path, and record the old and new ids in correction feedback. The operation SHALL be retry-safe and SHALL NOT overwrite the prior content or erase its evidence.

#### Scenario: Correct an active memory

- **WHEN** a user submits corrected content for an authorized active Memory
- **THEN** Kun creates one new reference-authority record, supersedes the old record, records one correction event, and returns the new version

#### Scenario: Retry after an uncertain response

- **WHEN** a correction request is replayed after its canonical mutation or feedback append may already have succeeded
- **THEN** Kun reconciles the stable operation identity and does not create another Memory version or count another correction

#### Scenario: Correct across scopes

- **WHEN** a correction attempts to create the new version in a different user, workspace, or project scope
- **THEN** Kun rejects the operation without mutating either record or the feedback ledger

### Requirement: Feedback collection is opt-in and failure-isolated

Persistent feedback collection SHALL be disabled by default. When disabled or degraded, Kun SHALL preserve the same Memory selected ids, ordering, context text, retrieval trace, turn outcome, and canonical mutations except for an explicit correction request whose own validation or mutation fails.

#### Scenario: Compare feedback enabled and disabled retrieval

- **WHEN** the same records, query, policy, time, and budget are evaluated with feedback collection enabled and disabled
- **THEN** the production retrieval result, order, features, and formatted Memory context are identical

#### Scenario: Retrieval feedback append fails

- **WHEN** an otherwise valid turn cannot persist its best-effort retrieval event
- **THEN** the turn continues with the already selected Memory context and diagnostics record the bounded feedback failure

#### Scenario: User disables feedback

- **WHEN** persistent feedback collection is disabled
- **THEN** no new retrieval or confirmation events are written and core Memory retrieval remains available

### Requirement: Feedback-aware ranking requires a separate passed gate

This change SHALL provide anonymous deterministic fixtures and an offline candidate that reports retrieval frequency, explicit confirmation, correction, freshness, importance, confidence, and final candidate score as separate bounded features. Retrieval frequency SHALL use a pre-registered logarithmic transform. No feedback feature SHALL affect production ranking unless a separately versioned decision passes relevance, uncertainty, safety, determinism, privacy, and resource gates.

#### Scenario: Evaluate a frequently retrieved but unconfirmed memory

- **WHEN** an anonymous fixture contains many retrieval impressions without explicit confirmation
- **THEN** the evaluator reports the bounded frequency feature separately and does not label the Memory as confirmed or authoritative

#### Scenario: Feedback candidate violates scope or lifecycle

- **WHEN** a candidate selects an out-of-scope, disabled, deleted, expired, or superseded record because of feedback
- **THEN** the decision is no-go regardless of ranked-quality improvement

#### Scenario: Offline candidate fails its benefit gate

- **WHEN** paired evaluation does not meet every pre-registered lower-bound and safety threshold
- **THEN** production keeps the existing lexical ranking and no dormant feedback weight is introduced
