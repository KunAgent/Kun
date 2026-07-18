## ADDED Requirements

### Requirement: Projects use a migratable frame-native sequence model
The engine SHALL store a versioned project with stable asset, sequence, track, clip, caption, link-group, effect, keyframe, transcript, and derived-media identities. Timeline ranges SHALL use non-negative integer frames and half-open intervals with rational frame rates.

#### Scenario: Existing schema-v1 project opens
- **WHEN** a valid 0.3.0 single-timeline project is loaded by the new engine
- **THEN** it SHALL migrate deterministically into one active sequence without changing source ranges, order, captions, canvas, revision provenance, or media grants

#### Scenario: Unsupported future project opens
- **WHEN** a project schema is newer than the engine supports
- **THEN** the engine SHALL preserve the project and return an actionable unsupported-version error without rewriting it

### Requirement: Projects support multiple and nested sequences
Users and tools SHALL be able to create, duplicate, rename, select, close, delete when safe, and nest sequences with cycle detection and stable view state.

#### Scenario: Agent creates an alternate cut
- **WHEN** the Agent duplicates the active sequence
- **THEN** the new sequence SHALL preserve content with new mutable IDs, become active only as requested, and leave the original unchanged

#### Scenario: A nesting cycle is requested
- **WHEN** a command would make a sequence directly or transitively contain itself
- **THEN** the transaction SHALL fail without changing the project

### Requirement: One command service owns UI and Agent mutations
Every manual and Agent mutation SHALL pass through one typed, serialized, revision-checked command service that validates the complete transaction, commits atomically, and emits one structured receipt.

#### Scenario: Human and Agent race on one revision
- **WHEN** a manual edit commits before an Agent command carrying the prior expected revision
- **THEN** the Agent command SHALL fail with the authoritative revision and SHALL NOT silently merge or overwrite the manual edit

#### Scenario: A batch contains one invalid operation
- **WHEN** any operation in a multi-operation command violates schema, media, timing, nesting, overlap, or authority invariants
- **THEN** none of the operations SHALL commit

### Requirement: Mutation receipts are bounded and actionable
A successful command receipt SHALL include the new revision, attribution, created/changed/removed IDs, compressed uniform shifts, track/sequence changes, proof invalidation, and bounded notes needed for the next read.

#### Scenario: Ripple delete shifts many clips
- **WHEN** a transaction removes a range and uniformly shifts at least three later clips
- **THEN** the receipt SHALL summarize the shift rule instead of returning every unchanged clip body

### Requirement: Agent undo cannot erase intervening user work
The engine SHALL track Agent-owned transactions separately and SHALL only undo the Agent's most recent eligible edit when no newer manual or foreign mutation intervenes.

#### Scenario: User edits after an Agent mutation
- **WHEN** the Agent asks to undo after the user has committed a manual change
- **THEN** the Agent undo SHALL refuse and preserve both changes while ordinary user undo remains available through the UI

### Requirement: Professional edit semantics are deterministic
The editing domain SHALL provide pure plans for split, trim, move, spatial reorder, snap, ripple insert/delete/trim, overwrite, linked A/V propagation, fades, keyframes, and nested sequence duration changes.

#### Scenario: Clip drag snaps to a valid target
- **WHEN** a clip edge moves within the configured pixel threshold of a playhead, clip edge, or beat target
- **THEN** the planner SHALL return the snapped frame and sticky state without mutating the project until commit

#### Scenario: Overwrite spans part of an existing clip
- **WHEN** a new clip overwrites a strict interior range of an existing clip
- **THEN** the transaction SHALL split the existing clip into source-continuous left and right fragments and place the new clip in the cleared range

### Requirement: Projects recover without destroying source or damaged metadata
Project writes SHALL be atomic, revision snapshots SHALL be bounded and recoverable, derived caches SHALL be disposable, and missing/revoked/changed media SHALL remain represented for explicit relink.

#### Scenario: Media metadata is unreadable
- **WHEN** the project state is valid but a media or derived manifest cannot be decoded
- **THEN** the editor SHALL open recoverable project structure, mark affected media offline, preserve the unreadable file, and refuse to replace it with an empty manifest during autosave
