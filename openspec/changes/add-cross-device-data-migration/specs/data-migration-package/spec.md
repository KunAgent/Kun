## ADDED Requirements

### Requirement: Selectable migration inventory
The system SHALL inventory known Code, Design, and Write workspace roots and their related Kun histories, SHALL let the user select workspaces and logical data categories, and SHALL provide counts and byte estimates before export begins.

#### Scenario: Current and historical workspaces are listed
- **WHEN** the user opens the export scope step
- **THEN** the system lists the current workspace and other known workspace roots with source path, estimated file bytes, related thread count, and Design/Write indicators

#### Scenario: History-only export is explicit
- **WHEN** the user selects thread history but deselects the referenced workspace files
- **THEN** the review marks those histories as requiring destination path repair or read-only handling after import

### Requirement: Versioned logical package
The system SHALL export one `.kunpack` with a fixed envelope identifier, a versioned logical manifest, per-component schema versions, a minimum reader version, and a ZIP64-compatible compressed payload whose entry names use relative POSIX separators.

#### Scenario: Package does not expose raw storage layout as its contract
- **WHEN** the exporter serializes runtime history
- **THEN** it writes canonical logical records and content rather than copying `index.sqlite3`, Chromium profile databases, or other implementation indexes

#### Scenario: Large package uses the same format
- **WHEN** an export contains a file or aggregate payload larger than classic ZIP limits
- **THEN** the exporter creates a valid ZIP64 payload without splitting the migration into manually managed files

### Requirement: Stable workspace identity
The exporter SHALL assign each selected logical workspace a package-scoped workspace ID and SHALL store workspace files as workspace ID plus relative path, never as an absolute archive entry.

#### Scenario: Windows workspace is packaged portably
- **WHEN** the source workspace is `D:\\Projects\\Atlas`
- **THEN** its files are stored under `payload/workspaces/<workspace-id>/...` without a drive letter, backslash-rooted entry, or destination path assumption

#### Scenario: Nested known workspaces do not duplicate bytes silently
- **WHEN** two selected logical workspace roots overlap
- **THEN** the export review explains the overlap and the package catalog records deterministic ownership so the same file is not duplicated without disclosure

### Requirement: Complete and size-optimized content presets
The system SHALL provide a Complete preset that includes regular files and hidden project content subject to hard safety exclusions, and a Smaller package preset that excludes an explicit list of known regenerable dependency, build, and cache paths.

#### Scenario: Design and Write artifacts are retained
- **WHEN** a selected workspace contains `.kun-design`, `.kunsdd`, Design system files, or Write documents
- **THEN** both presets include those files unless the user explicitly deselects their workspace or path

#### Scenario: Smaller preset explains exclusions
- **WHEN** the user selects Smaller package
- **THEN** the review shows each applied exclusion pattern and its estimated bytes instead of describing the exclusion as an opaque optimization

### Requirement: Consistent runtime snapshot
The Kun runtime SHALL serialize selected threads, sessions, messages, events, goals, todos, usage, and lineage from an immutable logical snapshot after selected histories are quiescent.

#### Scenario: Running turn blocks an unreviewed snapshot
- **WHEN** a selected thread has a running turn
- **THEN** export waits for completion or requires the user to interrupt or omit that thread before snapshot creation

#### Scenario: Pending gates are made historical
- **WHEN** a selected snapshot contains a pending approval or user-input gate
- **THEN** the exported record preserves it only as a non-actionable historical state and cannot resume the source gate on import

### Requirement: Reachable content export
The runtime snapshot SHALL include attachments, artifacts, memory records, and child/fork lineage that are reachable from the selected workspaces or histories, SHALL deduplicate content-addressed data, and SHALL exclude unrelated scoped content.

#### Scenario: Attachment remains readable in history
- **WHEN** a selected message references an attachment stored in the Kun attachment store
- **THEN** the package contains its validated metadata and bytes exactly once with a catalog reference from the selected history

#### Scenario: Unrelated attachment is excluded
- **WHEN** an attachment is scoped only to a workspace and thread that are not selected
- **THEN** the exporter does not include its metadata or bytes

### Requirement: Portable application state only
The exporter SHALL serialize an allowlisted, schema-validated subset of settings and renderer registries and SHALL not copy raw settings or localStorage databases.

#### Scenario: Portable registries are captured
- **WHEN** Design, Write, plan, SDD, fork, or thread registries reference selected data
- **THEN** the package includes their semantic records with typed workspace and thread references suitable for remapping

#### Scenario: Device-local preferences are excluded
- **WHEN** settings contain binary paths, ports, terminal/editor executables, local model paths, or other destination-device details
- **THEN** those fields are omitted and listed by category in the export policy

### Requirement: Credential and activation hard exclusions
The exporter MUST exclude provider/API secrets, OAuth sessions, runtime tokens, encryption/key-store material, workspace trust, approval grants, channel credentials, running process state, logs, crash/observability records, binaries, models, and temporary migration data, with no user override.

#### Scenario: Secret store cannot enter a package
- **WHEN** the Kun data directory contains `secret.key`, credential stores, or MCP OAuth files
- **THEN** no corresponding entry or secret value is present in the package even under Complete preset

#### Scenario: Scheduled task definition is selected
- **WHEN** the user elects to export workflow or schedule definitions
- **THEN** the package contains only a sanitized definition that requires disabled import and contains no channel credential or active trigger state

### Requirement: Sensitive workspace content acknowledgement
The system SHALL detect a documented set of sensitive-looking workspace names and metadata indicators, SHALL show the findings before export, and SHALL require explicit acknowledgement to include them while making clear that detection is not complete content secret scanning.

#### Scenario: Environment file is present
- **WHEN** a selected workspace contains `.env` or a recognized private-key filename
- **THEN** export cannot proceed with that file included until the user acknowledges the risk or excludes it

#### Scenario: No finding is not represented as no secrets
- **WHEN** the heuristic finds no sensitive-looking names
- **THEN** the review still states that ordinary project files may contain sensitive content and recommends package protection

### Requirement: Optional authenticated passphrase protection
When passphrase protection is enabled, the system SHALL derive an encryption key with a salted password KDF, SHALL encrypt the payload in independently authenticated bounded frames using a standard AEAD algorithm, and MUST NOT persist or log the passphrase or derived key.

#### Scenario: Protected package is created
- **WHEN** the user provides and confirms a passphrase
- **THEN** the package header contains only the required non-secret KDF/encryption parameters and the compressed payload is confidential and authenticated

#### Scenario: Unprotected package is allowed
- **WHEN** policy permits an unencrypted package and the user declines passphrase protection
- **THEN** the review and completion state visibly state that the package contents can be read by anyone who obtains the file

### Requirement: Streaming and workspace consistency
The exporter SHALL hash, compress, and optionally encrypt through bounded streams, SHALL detect a workspace file that changes during reading through pre/post identity checks, and SHALL never write the destination package inside a selected workspace or migration staging tree.

#### Scenario: File changes repeatedly during export
- **WHEN** a workspace file changes across the bounded retry limit
- **THEN** the exporter pauses for an explicit omit-or-cancel decision and records the outcome instead of silently packaging an inconsistent version

#### Scenario: Export destination would recurse
- **WHEN** the selected `.kunpack` destination is within any selected workspace
- **THEN** the system rejects the destination before scanning begins and requests another location

### Requirement: Package integrity and export report
The exporter SHALL record SHA-256, logical size, classification, and owner for every payload entry, SHALL bind the catalogs and checksum stream to the manifest, SHALL verify the finished package before success, and SHALL produce an export report of included, excluded, unstable, and failed items.

#### Scenario: Final verification fails
- **WHEN** the completed temporary package cannot be reopened and validated against its manifest and hashes
- **THEN** the exporter does not publish it at the requested final path and reports export failure

#### Scenario: Export succeeds atomically
- **WHEN** final package verification succeeds
- **THEN** the system atomically publishes the temporary package to the requested path and makes the local export report available
