## ADDED Requirements

### Requirement: Canonical memory records remain recoverable without SQLite

Kun SHALL preserve each memory as an atomically written canonical record and SHALL treat every SQLite memory table, FTS table, and retrieval row as a rebuildable projection.

#### Scenario: Memory index is deleted

- **WHEN** the configured memory index is missing while canonical memory records exist
- **THEN** Kun serves the canonical records, rebuilds the index in bounded batches, and loses no memory content or lifecycle state

#### Scenario: Process exits between canonical and index writes

- **WHEN** a create or update reaches the canonical file but the process exits before the index transaction commits
- **THEN** startup reconciliation detects the id/hash/update-time mismatch and projects the canonical record without duplicating it

#### Scenario: SQLite is unavailable

- **WHEN** the native SQLite module cannot load or the memory index cannot open, migrate, or query
- **THEN** explicit memory CRUD and bounded filesystem retrieval remain available and diagnostics report degraded index state

### Requirement: Memory V2 normalization is backward compatible

Kun SHALL parse existing memory JSON through a compatibility normalizer and SHALL provide deterministic defaults for every new V2 field without eagerly rewriting valid legacy files.

#### Scenario: Load a legacy memory

- **WHEN** a canonical record contains the current content, scope, provenance, confidence, and lifecycle fields but no V2 fields
- **THEN** Kun returns a valid V2 view with reference authority, a supported type, bounded importance, observation time, and normalized source evidence

#### Scenario: Encounter an unknown or malformed record

- **WHEN** a canonical memory cannot be normalized safely
- **THEN** Kun excludes it from retrieval, leaves the file unchanged, and exposes a bounded diagnostic identifying the record without leaking its body

#### Scenario: Preserve current API fields

- **WHEN** an existing GUI, TUI, tool, import/export path, or Manager proxy reads a normalized V2 record
- **THEN** the current id, content, scope, workspace, project, provenance, tags, confidence, timestamps, and lifecycle fields retain their compatible meanings

#### Scenario: Round-trip a portable V2 export

- **WHEN** the settings UI exports active memories and imports the resulting Kun Memory V2 archive
- **THEN** content, scope paths, tags, confidence, type, reference authority, importance, validity, expiry, bounded sources, and disabled state are preserved while each imported record receives a fresh id and audit timestamps

### Requirement: Memory evidence and authority are explicit and bounded

Every normalized memory SHALL have reference authority and SHALL expose a bounded source-evidence list derived from explicit input or compatible legacy provenance.

#### Scenario: User explicitly creates a memory

- **WHEN** the user confirms a memory through the existing tool or settings UI
- **THEN** the canonical record identifies explicit-user trust and any available thread/turn evidence without granting instruction authority

#### Scenario: Import a memory without provenance

- **WHEN** an accepted legacy import has no source locator
- **THEN** Kun records imported/legacy evidence with bounded trust metadata and does not fabricate a thread, turn, file, or URL

#### Scenario: Source excerpt exceeds its budget

- **WHEN** source evidence contains a long excerpt or locator
- **THEN** contract validation truncates or rejects it according to documented limits before canonical persistence and indexing

### Requirement: Confidence, freshness, and importance remain independent

Kun SHALL preserve confidence as belief strength, SHALL compute freshness from temporal metadata, and SHALL store importance as a separate bounded signal.

#### Scenario: A trusted fact becomes old

- **WHEN** a high-confidence memory has not been observed or confirmed for a long period
- **THEN** its confidence remains unchanged while its computed freshness may decrease

#### Scenario: A recent inference is uncertain

- **WHEN** a newly observed memory has inference provenance and low confidence
- **THEN** high freshness does not increase its confidence

#### Scenario: Validity expires

- **WHEN** the current time is outside a memory's explicit validity interval or TTL
- **THEN** the record is excluded from active retrieval regardless of importance or lexical relevance

### Requirement: Manager owns one logical production memory repository

Production serve mode SHALL route canonical memory and index operations through one Manager-owned repository per data root, and capability configuration changes SHALL NOT create independent physical memory stores.

#### Scenario: Runtime configuration hot reloads

- **WHEN** memory scopes, enablement, or injection limits change at runtime
- **THEN** subsequent operations use the new policy against the same canonical records and index

#### Scenario: Multiple runtime clients use memory

- **WHEN** GUI, TUI, API, or concurrent Kun clients access memory through the Manager
- **THEN** they observe one serialized canonical lifecycle and contract-equivalent results

#### Scenario: Local serve mode runs without Manager

- **WHEN** Kun starts in a supported direct local composition
- **THEN** it uses the same hybrid-memory contract and canonical/index ordering without starting another service

### Requirement: Lifecycle mutations keep projections consistent

Create, update, disable, restore, supersede, delete, and purge operations SHALL update canonical state first and SHALL make every derived memory index converge to that state.

#### Scenario: Delete an indexed memory

- **WHEN** a memory is soft-deleted
- **THEN** it remains auditable in canonical state and is excluded from active FTS candidates and turn injection

#### Scenario: Purge an exact memory id

- **WHEN** an authorized purge removes a validated canonical memory id
- **THEN** its FTS row and other foundation projections are removed in the same operation or by idempotent reconciliation

#### Scenario: Index update fails after a mutation

- **WHEN** canonical mutation succeeds but index projection fails
- **THEN** the operation reports canonical success with degraded diagnostics and reconciliation repairs the projection later

### Requirement: Memory index state is diagnosable without exposing secrets

Memory diagnostics SHALL report canonical count, index status and schema, indexed/stale counts, backfill status, and bounded failure reasons while preserving current diagnostic fields.

#### Scenario: Inspect a healthy store

- **WHEN** canonical records and index projection agree
- **THEN** diagnostics report ready state and matching bounded counts

#### Scenario: Inspect a corrupt index

- **WHEN** SQLite integrity, schema, or query validation fails
- **THEN** diagnostics report a degraded/rebuildable index without including memory bodies, credentials, or machine-private source excerpts

#### Scenario: Native failure contains a local path

- **WHEN** a SQLite or native-module error contains Windows, UNC, POSIX, or file-URL paths
- **THEN** the bounded degraded reason redacts the absolute path while retaining actionable module, platform, architecture, and ABI details
