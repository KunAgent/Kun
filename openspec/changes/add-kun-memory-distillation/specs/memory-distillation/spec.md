## Purpose

Define a bounded and approval-gated path for deriving durable Memory candidates from completed Kun turns while preserving Memory V2 scope, lifecycle, provenance, and reference-only authority guarantees.

## ADDED Requirements

### Requirement: Distillation candidates are strict and bounded

The system SHALL parse model output as a strict `MemoryCandidateDraft` containing only `content`, an existing `MemoryType`, `confidence`, `importance`, `tags`, and one to eight source ids. The host SHALL resolve those ids from authoritative current-turn evidence and SHALL supply `observedAt` before producing a `MemoryCandidate` with bounded `MemorySourceEvidence`. Candidate content SHALL contain at most 4,096 characters, tags SHALL contain at most 16 normalized values of at most 64 characters each, confidence and importance SHALL be within `[0,1]`, and source ids SHALL be unique. The draft contract SHALL reject unknown fields, including model-supplied source records, observation time, scope, and authority.

#### Scenario: A valid candidate is normalized

- **WHEN** a candidate draft contains compatible Unicode, repeated whitespace, mixed-case duplicate tags, and source ids in a non-canonical order
- **THEN** the draft is normalized deterministically without changing its factual meaning
- **AND** its source ids resolve to complete host-owned evidence with the host-provided observation time

#### Scenario: A malformed candidate is rejected

- **WHEN** a candidate draft is empty, oversized, has an unsupported type, has an invalid score, has no source id, has duplicate source ids, names an unauthorized source id, supplies provenance or observation time, or includes another unknown field
- **THEN** contract validation fails before comparison, approval, or persistence

### Requirement: Eligibility fails closed for unsafe or transient candidates

The decision core SHALL return `skip` for credential-like content or evidence, confidence below `0.6`, and content assessed or deterministically identified as transient. A model-provided durable assessment SHALL NOT override deterministic credential or transient-request detection.

#### Scenario: A low-confidence inference is skipped

- **WHEN** a candidate has confidence below `0.6`
- **THEN** the decision is `skip` with reason `low-confidence`
- **AND** no persistence operation is produced

#### Scenario: A one-turn request is skipped

- **WHEN** a candidate is assessed as transient or contains a bounded English or Chinese one-turn request signal
- **THEN** the decision is `skip` with reason `non-durable`

#### Scenario: Credential-like data is skipped

- **WHEN** candidate content or source evidence contains a private key, bearer token, password assignment, or recognized API-token form
- **THEN** the decision is `skip` with reason `sensitive`
- **AND** a durable assessment does not allow the candidate to proceed

### Requirement: Candidate decisions are pure and explainable

The system SHALL expose a deterministic, side-effect-free decision operation that accepts one normalized candidate draft, its durability assessment, a bounded list of comparison relations, authoritative current-turn evidence/observation time, and the active authorized Memory records returned by the host. It SHALL bind only authorized sources, return exactly one `create`, `update`, `supersede`, or `skip` decision, and SHALL NOT read or write a MemoryStore, invoke a model, or request approval.

#### Scenario: No matching memory exists

- **WHEN** an eligible candidate has no exact duplicate and no validated comparison relation
- **THEN** the decision is `create` and contains the normalized candidate

#### Scenario: The same fact already exists

- **WHEN** an active authorized record has the same normalized content or a validated `duplicate` relation targets that record
- **THEN** the decision is `skip` with reason `duplicate`
- **AND** another Memory is not created

#### Scenario: Existing evidence should be enriched

- **WHEN** an eligible candidate has a validated `update` relation to an active authorized record
- **THEN** the decision is `update`, names that record id, and retains the candidate sources for the later approval request

#### Scenario: A newer fact conflicts with an existing fact

- **WHEN** an eligible candidate has a validated `supersede` relation to an active authorized record
- **THEN** the decision is `supersede`, names that record id, and retains the candidate sources for the later approval request

#### Scenario: A comparison targets an unavailable record

- **WHEN** a comparison names a record that is absent from the host-provided authorized set or is inactive at decision time
- **THEN** decision validation fails closed instead of creating or mutating a Memory

#### Scenario: Reordered inputs produce the same result

- **WHEN** equivalent candidate sources, tags, comparisons, and existing records arrive in different orders
- **THEN** normalization and decision selection produce the same candidate and action

### Requirement: Scope, evidence, and authority remain host-owned

The host SHALL choose the candidate target scope and observation time from the current runtime context, construct authoritative source evidence from the completed turn, and retrieve comparison records through the existing scope- and lifecycle-filtered Memory path. Model output SHALL be limited to source ids from that host-provided set and SHALL NOT supply source kind, trust, thread/turn ids, locators, excerpts, observation time, or broaden user, workspace, or project access. Every approved result SHALL remain `authority=reference`, including results backed by inference sources.

#### Scenario: A model proposes an arbitrary target

- **WHEN** structured model output includes scope, project path, workspace path, authority, full source evidence, observation time, an unknown source id, or a comparison id outside the authorized retrieval result
- **THEN** the output is rejected before approval or persistence

#### Scenario: Host evidence is bound without model-controlled trust

- **WHEN** a valid draft names a source id from the current host-owned evidence set
- **THEN** the resulting candidate receives the exact host-owned source record and observation time
- **AND** model output cannot change the source kind, trust, thread id, turn id, locator, or excerpt

#### Scenario: Inferred content is approved

- **WHEN** a user approves an eligible candidate whose source trust is `inferred`
- **THEN** the resulting Memory remains reference-only context and never gains user or system instruction authority

### Requirement: Production distillation runs only after durable turn completion

When enabled in the later runtime delivery, the coordinator SHALL asynchronously consider only a durably persisted `completed` turn containing non-empty user and assistant text. Failed, aborted, interrupted, or empty turns SHALL NOT trigger distillation. The feature SHALL be disabled by default and a distillation failure SHALL NOT delay, fail, or reverse the completed turn.

#### Scenario: A completed turn is eligible

- **WHEN** the opt-in setting is enabled and a turn with non-empty user and assistant text has been persisted as `completed`
- **THEN** at most one asynchronous distillation request is scheduled for that turn

#### Scenario: A non-completed turn is ignored

- **WHEN** a turn is failed, aborted, interrupted, missing persisted completion, or missing non-empty user or assistant text
- **THEN** no distillation request or pending candidate is created

#### Scenario: Distillation fails after completion

- **WHEN** the bounded model request times out, is unavailable, or returns invalid structured output
- **THEN** the failure is recorded with sanitized bounded diagnostics
- **AND** the already completed turn remains completed

### Requirement: Model use is bounded and reuses the Kun route

The runtime coordinator SHALL reuse the initiating turn's resolved Kun provider and model through the existing `ModelClient` path, without separate credentials or a renderer-side request implementation. It SHALL send only bounded current-turn user and assistant text plus opaque allowed source ids, expose no tools, request strict JSON with deterministic sampling, reject model-supplied full evidence or observation time, cap input at 24,000 characters, cap output at 2,048 tokens and eight candidates, enforce a 15-second timeout, and perform at most one provider request per eligible turn.

#### Scenario: The extraction budget is exceeded

- **WHEN** current-turn text or structured output exceeds a configured hard limit
- **THEN** the coordinator truncates input at a recorded boundary or rejects oversized output
- **AND** it does not retry with an unbounded request

#### Scenario: A separate provider is suggested

- **WHEN** model output or renderer state attempts to select a different provider, account, endpoint, or credential for distillation
- **THEN** the coordinator ignores or rejects that selection and uses only the initiating Kun route

### Requirement: Every candidate has an independent durable approval outcome

The runtime delivery SHALL persist pending candidates across restart using a fingerprint derived from the thread id, turn id, and normalized candidate. Approval SHALL be recorded per candidate even when the UI offers a bulk action. Allow SHALL be the only outcome that can invoke MemoryStore; deny, expiry, timeout, or withdrawal before persistence SHALL produce a terminal non-writing outcome that replay does not reopen. Withdrawal after an approved Memory write SHALL use normal Memory lifecycle operations rather than rewriting approval history.

#### Scenario: A pending candidate survives restart

- **WHEN** the application restarts before a candidate receives a terminal approval outcome
- **THEN** the same pending candidate is restored once with its original evidence and decision

#### Scenario: A candidate is denied or expires

- **WHEN** a user denies a candidate or its approval reaches timeout or expiry
- **THEN** no MemoryStore mutation occurs
- **AND** replay of the source turn does not recreate the pending candidate

#### Scenario: One candidate in a batch is allowed

- **WHEN** a UI action allows one candidate and denies another candidate from the same turn
- **THEN** only the allowed candidate can mutate MemoryStore
- **AND** both independent outcomes remain auditable

### Requirement: Distillation quality is reproducible

The change SHALL include anonymous English and Chinese fixtures covering facts, preferences, decisions, transient requests, low-confidence inferences, credentials, exact duplicates, related updates, and conflicts. Evaluation SHALL report decision accuracy, unsafe non-skip count, duplicate create count, and source completeness with deterministic results.

#### Scenario: P1-A fixtures are evaluated

- **WHEN** the pure candidate suite runs repeatedly on the same fixture set
- **THEN** it reports zero unsafe non-skip decisions, zero duplicate creates, complete sources for every non-skipped candidate, and identical decisions across runs

#### Scenario: P1 is accepted end to end

- **WHEN** P1-B runtime and UI acceptance are complete
- **THEN** approval-before-write violations, writes after rejection, scope leaks, transient-request writes, authority elevations, replay duplicates, and turn failures caused by distillation are all zero

### Requirement: P1-A changes no production turn behavior

The P1-A delivery SHALL contain only OpenSpec artifacts, candidate contracts, normalization, pure decision code, anonymous fixtures, and evaluation tests. It SHALL NOT wire TurnEnd hooks, settings, approval UI, a production model call, or MemoryStore mutation.

#### Scenario: P1-A is reviewed independently

- **WHEN** the P1-A branch is compared with its develop base
- **THEN** no production lifecycle, settings, renderer, approval, or store integration file is changed
- **AND** importing or not importing the new pure modules leaves existing application behavior unchanged
