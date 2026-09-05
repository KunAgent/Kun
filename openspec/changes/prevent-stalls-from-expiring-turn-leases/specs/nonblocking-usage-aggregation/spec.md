## ADDED Requirements

### Requirement: Usage queries do not block runtime liveness
The system SHALL execute usage scanning, parsing, timezone grouping, and aggregation outside Runtime and Manager control event loops, and SHALL return the existing public usage DTOs without transmitting the complete usage history through the Runtime data plane.

#### Scenario: Large global history is queried during an active turn
- **WHEN** a client requests global, daily, or model usage while a turn is renewing its lease
- **THEN** heartbeats and lease renewals remain schedulable and the response is produced by isolated query execution

#### Scenario: Indexed query cannot finish within its deadline
- **WHEN** isolated usage execution exceeds the bounded query deadline
- **THEN** the route returns a structured temporary failure and does not replay history synchronously on a control loop

### Requirement: Scoped usage does not hydrate conversation history
Thread and turn usage queries MUST use persisted usage facts and metadata attribution without loading full thread messages, items, or event history on the request path.

#### Scenario: Turn prices are requested for a large thread
- **WHEN** `/v1/usage?group_by=turn&thread_id=<id>` is requested
- **THEN** only indexed facts for that thread are read and the existing turn pricing response is preserved

### Requirement: Usage recovery is bounded and resumable
The system SHALL rebuild the usage index from canonical events in bounded chunks with durable progress, and Manager SHALL remain the only physical writer.

#### Scenario: Recovery is interrupted between chunks
- **WHEN** the process restarts after one or more usage-index chunks commit
- **THEN** recovery resumes after the durable high-water mark without duplicating counters

#### Scenario: Legacy provider attribution is unavailable
- **WHEN** a historical event and recoverable turn metadata contain no provider attribution
- **THEN** the fact is marked unknown instead of being assigned the thread's current provider

### Requirement: Renderer usage refreshes are demand driven
The Renderer SHALL use live SSE usage for the active turn, refresh persisted history once after terminal settlement, coalesce identical requests, and disable requests from hidden usage panels.

#### Scenario: Multi-step turn emits several usage events
- **WHEN** an active turn emits multiple model-step usage snapshots
- **THEN** the UI updates live counters without issuing one history query per snapshot

#### Scenario: Previously visited usage tab is hidden
- **WHEN** another right-panel tab is active
- **THEN** the mounted usage panel preserves presentation state but issues no thread, daily, or model requests
