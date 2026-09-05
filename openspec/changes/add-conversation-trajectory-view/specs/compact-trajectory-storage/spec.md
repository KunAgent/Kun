## ADDED Requirements

### Requirement: Always-on compact request lifecycle
Kun SHALL persist compact lifecycle metadata for every logical model round and every actual Provider attempt regardless of complete-content capture state.

#### Scenario: Capture disabled request
- **WHEN** a thread has complete-content capture disabled and sends a model request
- **THEN** Kun persists stable round/request/turn/step/attempt identity, provider/model/purpose, status, timing, usage, error, and item relationships without prompt or raw response bodies

#### Scenario: Provider retry
- **WHEN** one logical model step performs multiple Provider attempts
- **THEN** every attempt has a unique request ID and attempt ordinal while sharing the logical round and step identity

### Requirement: Bounded lifecycle writes and restart recovery
Kun SHALL persist lifecycle start, first-content, terminal, and at most one lightweight progress checkpoint per two seconds, and SHALL never persist ordinary stream deltas as trajectory records.

#### Scenario: Runtime exits mid-request
- **WHEN** Kun restarts with a persisted request that never reached a terminal lifecycle state
- **THEN** the request is exposed as interrupted and checkpoints older than 24 hours are removed

### Requirement: Canonical Session references
Trajectory metadata SHALL reference canonical user, assistant, reasoning, tool, compaction, and attachment records instead of duplicating their full content.

#### Scenario: Tool completes
- **WHEN** a tool call and result share a call ID
- **THEN** the trajectory projection exposes one tool lifecycle record with item references, start/end timing, status, and bounded previews

### Requirement: Content-addressed prompt manifests
When complete-content capture is enabled, Kun SHALL create a prompt manifest with ordered item/message references, Session boundary, attachment metadata, and sanitized SHA-256 blob references for System Prompt, tool schemas, request configuration, and fallback fragments.

#### Scenario: Repeated prompt components
- **WHEN** multiple requests use identical System Prompt or tool schema bytes
- **THEN** they reference one immutable Brotli-compressed blob rather than storing duplicate content

#### Scenario: Oversized content
- **WHEN** one sanitized blob exceeds 8 MiB
- **THEN** Kun stores a bounded head/tail representation with original size, content hash, and explicit truncation state

### Requirement: Sensitive and binary content exclusion
Trajectory persistence SHALL remove credentials before hashing or writing and SHALL NOT retain raw HTTP headers/frames, authorization values, cookies, attachment bodies, image/Base64 payloads, or complete tool outputs.

#### Scenario: Secret appears in request metadata
- **WHEN** a configured credential appears in a URL, header, request option, or fallback fragment
- **THEN** neither the metadata journal, manifest, blob, index, DTO, nor warning log contains the credential value

### Requirement: Detail retention budgets
Kun SHALL cap retained detailed content at 64 MiB per thread and 512 MiB globally, keep inline previews at 16 KiB and search previews at 2 KiB, and SHALL preserve lifecycle metadata when detail is evicted.

#### Scenario: Global detail budget reached
- **WHEN** adding content would exceed the global detail budget
- **THEN** least-recently-used inactive detail is evicted, metadata remains queryable, and affected records report an evicted detail state

### Requirement: Authoritative filesystem and rebuildable index
Trajectory journals, manifests, and blobs SHALL be authoritative filesystem data; any SQLite trajectory index SHALL be rebuildable, and query APIs SHALL work through a bounded filesystem fallback.

#### Scenario: SQLite unavailable
- **WHEN** the hybrid SQLite binding or trajectory tables are unavailable
- **THEN** trajectory paging, summary, filter, and bounded search continue from the compact filesystem data with a degradation warning

### Requirement: Trajectory query APIs
Kun SHALL expose authenticated, thread-isolated trajectory page, summary, and section-detail routes with versioned DTOs, opaque cursors, and safe handling of unknown or missing data.

#### Scenario: Query another thread record
- **WHEN** a client requests a detail ID that does not belong to the route thread
- **THEN** Kun returns not found without disclosing the record

### Requirement: Legacy compatibility and deletion
Kun SHALL read legacy schema-v1 model-request traces without destructive migration and SHALL remove the thread's trajectory metadata, manifests, legacy traces, and unreferenced blobs when the thread is deleted.

#### Scenario: Open pre-upgrade conversation
- **WHEN** a conversation has only schema-v1 trace records
- **THEN** the trajectory API projects recoverable legacy metadata and marks unavailable new fields without failing the conversation
