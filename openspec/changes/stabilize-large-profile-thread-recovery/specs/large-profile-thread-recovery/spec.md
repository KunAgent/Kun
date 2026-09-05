## ADDED Requirements

### Requirement: Recovery requests are coordinated and cancellable
The desktop SHALL execute at most one equivalent physical recovery read per thread, SHALL let concurrent recovery triggers join that flight, and SHALL cancel obsolete cancellable reads when thread or Runtime identity changes.

#### Scenario: Concurrent triggers join one recovery
- **WHEN** selection, watchdog, stream recovery, and manual retry request recovery for the same thread while a recovery is in flight
- **THEN** they receive the same recovery result and only one physical timeline request is issued

#### Scenario: Selection cancels obsolete hydration
- **WHEN** the user leaves a thread whose timeline hydration is still running
- **THEN** Main aborts the corresponding Runtime fetch and its late result cannot update the new thread

### Requirement: Trusted snapshots remain visible during catch-up
The renderer SHALL immediately render a trusted cached projection while replay synchronization is pending, SHALL clearly identify that state as catching up, and SHALL keep composer mutations disabled until synchronization or terminal failure.

#### Scenario: Running cached thread is reopened
- **WHEN** a previously confirmed running projection is selected and its cursor remains valid
- **THEN** its messages are visible within the next paint while SSE resumes from its saved cursor

#### Scenario: Cold thread has no trusted content
- **WHEN** a selected thread has no trusted cached projection
- **THEN** the full-area hydration state remains visible until a timeline snapshot is available or the read fails

### Requirement: Recovery prefers lightweight reconciliation
The renderer SHALL use a trusted projection plus lightweight thread state and cursor replay for ordinary disconnects, and SHALL request a full timeline only for cold hydration, invalidated snapshots, or replay-reset recovery.

#### Scenario: Healthy cursor resumes without timeline
- **WHEN** a busy thread has trusted blocks and the persisted replay floor does not exceed its cursor
- **THEN** recovery opens SSE from that cursor without loading the full timeline

#### Scenario: Compacted cursor forces hydration
- **WHEN** state or SSE reports that the trusted cursor predates retained event history
- **THEN** recovery performs one coordinated timeline hydration and replaces the projection before reconnecting

### Requirement: Background prewarm is bounded and subordinate
Thread prewarm SHALL wait for stable user intent, keep a bounded newest-first queue, cancel abandoned queued work, and pause while foreground recovery or Runtime overload is active.

#### Scenario: Pointer sweeps many rows
- **WHEN** the pointer enters and leaves many sidebar rows without dwelling
- **THEN** no more than the bounded prewarm queue is retained and abandoned rows issue no timeline request

#### Scenario: Foreground recovery starts
- **WHEN** a foreground thread recovery begins while prewarm work is queued
- **THEN** queued background work pauses and active cancellable prewarm yields to foreground recovery

### Requirement: Live checkpoints have bounded lag
The Runtime SHALL avoid entering the per-thread write lane for every model delta and SHALL durably advance a live item checkpoint after at most 64 KiB, 128 durable delta events, or one second, whichever occurs first.

#### Scenario: Small long-running reasoning stream
- **WHEN** reasoning grows by less than 64 KiB while producing more than 128 delta events
- **THEN** its durable checkpoint advances before the 129th uncheckpointed event is exposed

#### Scenario: Low-volume stream
- **WHEN** a live item receives fewer than 128 events and less than 64 KiB over one second
- **THEN** its latest aggregate and represented sequence are flushed without waiting for the byte threshold

### Requirement: Persisted event replay seeks through a sparse index
The file session store SHALL maintain a rebuildable sparse sequence-to-byte-offset sidecar and SHALL use a validated index to begin replay near `sinceSeq` without changing `events.jsonl` authority.

#### Scenario: Indexed replay near file tail
- **WHEN** replay starts near the tail of a large indexed event file
- **THEN** the reader begins no earlier than two configured index intervals before the requested sequence

#### Scenario: Missing or corrupt index
- **WHEN** an index is absent, stale, truncated, or inconsistent with the event file
- **THEN** replay falls back to the authoritative JSONL, returns correct ordered events, and may rebuild the sidecar

### Requirement: Timeline reads apply admission and request coalescing
The Runtime SHALL join identical authenticated timeline reads, SHALL reserve capacity for foreground recovery, and SHALL return a retryable overload response rather than allowing an unbounded queue.

#### Scenario: Twenty identical timeline reads
- **WHEN** twenty clients request the same thread, cursor, and page while the first read is in flight
- **THEN** one storage read is performed and all clients receive the equivalent result

#### Scenario: Read queue is full
- **WHEN** a new timeline read arrives after its priority queue reaches the configured bound
- **THEN** the Runtime responds with HTTP 503 and `Retry-After` without being classified as process failure

### Requirement: Automatic maintenance is resumable and foreground-aware
Automatic attachment, guardian, index, and compaction maintenance SHALL use one low-priority lane, SHALL stop each slice after a bounded time or thread count, SHALL persist progress, and SHALL pause for active turns or foreground recovery.

#### Scenario: Runtime restarts during maintenance
- **WHEN** the Runtime stops after completing part of a maintenance generation
- **THEN** the replacement Runtime resumes from persisted progress instead of scanning again from the first thread

#### Scenario: Active recovery arrives
- **WHEN** foreground recovery begins during a maintenance cycle
- **THEN** no new maintenance slice starts until foreground work is clear

#### Scenario: Partial attachment generation
- **WHEN** only part of the thread inventory has been scanned for attachment references
- **THEN** no attachment is deleted from that incomplete generation

### Requirement: Runtime overload degrades without a restart storm
The desktop SHALL keep liveness independent of queued storage work, SHALL back off retryable overload, and SHALL pause optional background work during a restart cooldown.

#### Scenario: Host CPU is saturated
- **WHEN** health probes or read admission observe transient overload while the Runtime process remains alive
- **THEN** background work pauses and recovery backs off without immediately replacing the Runtime

#### Scenario: Repeated liveness failures
- **WHEN** the configured consecutive liveness failure threshold is crossed
- **THEN** the supervisor performs at most one restart in the cooldown window and the replacement starts with optional background work paused

### Requirement: Recovery and replay expose bounded diagnostics
The system SHALL expose counters and timing needed to verify joined/cancelled recovery, replay seek position and bytes, checkpoint lag, maintenance slices, overload, and Runtime restarts without logging message contents or credentials.

#### Scenario: Recovery benchmark completes
- **WHEN** a large-profile recovery benchmark finishes
- **THEN** its report includes physical versus joined recovery counts, replay work, maximum checkpoint lag, maintenance p99 slice time, timeline tail latency, and restart count
