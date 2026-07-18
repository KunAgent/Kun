## ADDED Requirements

### Requirement: Non-mutating package inspection
The system SHALL inspect a selected package and produce a complete import plan before changing destination workspaces, Kun runtime stores, application settings, or renderer state.

#### Scenario: User selects a valid package
- **WHEN** the package is selected and any required passphrase is supplied
- **THEN** the system validates it and displays source platform/version, contents, expanded size, mappings, conflicts, exclusions, and required user decisions with zero destination mutation

#### Scenario: User abandons inspection
- **WHEN** the user closes or cancels during inspection
- **THEN** the system discards inspection state without creating destination files or runtime records

### Requirement: Version compatibility and staged schema migration
The importer SHALL use package and component schema versions rather than source application version alone, SHALL apply deterministic supported migrators only in staging, and SHALL reject unsupported required versions before mutation.

#### Scenario: Newer app exports a supported format
- **WHEN** `sourceAppVersion` is newer than the destination app but all required format/component versions are supported
- **THEN** inspection can succeed with an informational version warning

#### Scenario: Required format is too new
- **WHEN** the package requires a format or component version the importer does not support
- **THEN** inspection stops with an upgrade-required error and no target data is changed

#### Scenario: Older component needs upgrade
- **WHEN** an older supported component schema is present
- **THEN** its migrator transforms and validates a staged copy while the original package remains unchanged

### Requirement: Hostile archive validation
The importer MUST reject archive traversal, absolute or drive-prefixed entries, unsafe UNC/ADS/device names, undeclared or ambiguous duplicate entries, unsafe links, unsupported compression, integrity failures, expansion-budget violations, and decompression-bomb behavior before extraction to a destination.

#### Scenario: Zip-slip entry is present
- **WHEN** an entry normalizes outside its declared package subtree
- **THEN** inspection rejects the entire package with a security error and does not extract the entry

#### Scenario: Manifest understates expanded bytes
- **WHEN** observed expanded bytes exceed the declared or available-disk budget
- **THEN** extraction stops in staging, staging is cleaned or retained only for recovery diagnostics, and no final destination is committed

#### Scenario: Unencrypted checksums are modified consistently by an attacker
- **WHEN** a structurally valid unencrypted package passes accidental-corruption hashes
- **THEN** the importer still treats every payload as untrusted and grants no execution, trust, or activation based on checksum success

### Requirement: Explicit workspace destination mapping
The import plan SHALL require one user-approved destination root for each imported workspace that will restore files, SHALL recommend a new collision-free folder, and SHALL support skipping the workspace while preserving its history as unmapped.

#### Scenario: Suggested destination already exists
- **WHEN** the default destination name exists
- **THEN** the importer recommends a numbered or Imported-suffixed folder rather than enabling merge or replace automatically

#### Scenario: Workspace is skipped but history is selected
- **WHEN** the user skips a workspace and keeps its conversations
- **THEN** those conversations import with an unresolved workspace state and remain readable without pretending the old source path exists

### Requirement: Cross-platform file-system preflight
The importer SHALL evaluate entry names and metadata using both the declared source platform and actual destination file-system behavior, and SHALL detect case/Unicode collisions, invalid or reserved names, path length violations, file/directory type conflicts, and unsupported links before commit.

#### Scenario: Linux case distinction cannot fit on target
- **WHEN** a source directory contains `A.ts` and `a.ts` and the destination folds them to the same name
- **THEN** commit is blocked until the user selects another destination, skips an entry, or explicitly renames one with a broken-reference warning

#### Scenario: Windows reserved name is imported
- **WHEN** an entry is not representable as a legal Windows path
- **THEN** the importer does not silently sanitize it and requires explicit skip or stable rename resolution

#### Scenario: External symlink is present
- **WHEN** an archived link is absolute or resolves outside its declared workspace
- **THEN** it is never recreated or followed and is reported as an unsafe excluded entry

### Requirement: Typed path rebinding
The importer SHALL map package workspace IDs to destination roots and SHALL rewrite only versioned operational path fields declared by the migration schema, using source-platform parsing and destination-platform construction.

#### Scenario: Structured Windows path moves to macOS
- **WHEN** a thread workspace and attachment local file field refer to a file under a packaged Windows root
- **THEN** both fields resolve to the mapped macOS root plus the same logical relative path

#### Scenario: Old path appears in prose
- **WHEN** the same source absolute path appears in chat text, source code, or shell output
- **THEN** the importer preserves that text and does not run a global string replacement

#### Scenario: Known operational path is outside selected roots
- **WHEN** a typed operational field points outside every packaged workspace
- **THEN** the importer records it as unresolved and disables or repairs the owning feature explicitly instead of guessing a target

### Requirement: Collision-safe thread and reference import
The runtime importer SHALL deduplicate a colliding thread ID only when canonical content is identical, SHALL allocate a new ID when content differs, and SHALL rewrite all typed lineage, registry, event, attachment-scope, and related references through one consistent ID map.

#### Scenario: Same package is imported twice
- **WHEN** an already imported canonical thread is encountered again
- **THEN** the runtime deduplicates it and does not create a second identical history

#### Scenario: Destination has a different thread with the same ID
- **WHEN** canonical hashes differ for a colliding ID
- **THEN** the imported thread receives a new ID and its parent/fork/side and renderer registry references remain internally consistent

### Requirement: Conservative workspace conflict policy
The importer SHALL default to Keep both, SHALL require explicit opt-in to merge or replace, SHALL deduplicate identical files by hash, and SHALL back up every destination file replaced by the operation.

#### Scenario: Merge encounters different content
- **WHEN** source and destination have different bytes at the same path under Merge
- **THEN** the default resolution keeps the destination and requires the user to select imported sibling, replacement with backup, or skip

#### Scenario: Merge encounters identical content
- **WHEN** source and destination hashes are identical
- **THEN** the importer keeps the destination copy without reporting a destructive conflict

#### Scenario: Replace is selected
- **WHEN** the user explicitly chooses to replace a differing destination file
- **THEN** the review names the affected workspace and backup behavior and commit records the original file in the operation backup before replacement

### Requirement: Imported state is inactive and untrusted
The importer MUST clear credentials and active external bindings, MUST NOT restore trust or approvals, SHALL normalize running/pending execution state, SHALL import schedule definitions disabled, and SHALL require normal destination authorization before any imported project, hook, workflow, or integration executes.

#### Scenario: Imported scheduled task was enabled on source
- **WHEN** its sanitized definition is imported
- **THEN** it is disabled, channel bindings are cleared, and the completion report requests review and reauthentication

#### Scenario: Imported project contains executable hooks
- **WHEN** workspace files are committed successfully
- **THEN** Kun does not open or execute the project automatically and the destination trust flow remains required

#### Scenario: Thread provider is unavailable
- **WHEN** an imported thread references a provider/model not configured on the destination
- **THEN** history remains readable and a new turn requires an explicit available provider/model choice without importing source credentials

### Requirement: Per-target disk and resource validation
The importer SHALL calculate staging bytes, replacement backup bytes, and safety margin separately for each target file system, SHALL recheck free space before commit, and SHALL use bounded streaming resources.

#### Scenario: One of several target disks is short
- **WHEN** any mapped workspace or runtime target lacks estimated peak space
- **THEN** import cannot start even if another target disk has enough aggregate free space

#### Scenario: Disk fills during staging
- **WHEN** a write reports insufficient space despite preflight
- **THEN** no final commit begins, the operation reports the affected target, and staged data can be cleaned safely

### Requirement: Journaled staging and commit
The importer SHALL stage validated data on the same file system as each final target, SHALL persist an idempotent operation journal before every commit mutation, SHALL hold a scoped Kun migration maintenance lock for runtime commit, and SHALL verify/rebuild indexes before marking completion.

#### Scenario: Clean import succeeds
- **WHEN** staging, runtime preflight, workspace commit, runtime commit, portable-state apply, and verification all succeed
- **THEN** the journal is marked completed and a final report records every operation and mapping

#### Scenario: Runtime cannot enter maintenance
- **WHEN** an active mutation prevents the runtime import lock
- **THEN** final commit does not begin and the user is offered wait, interrupt eligible work, or cancel

### Requirement: Cancellation, crash recovery, and rollback
The importer SHALL cancel immediately during inspection, SHALL clean staging during staging cancellation, SHALL roll back after a commit-phase cancellation or failure, and SHALL offer Resume or Roll back on startup for any incomplete durable journal.

#### Scenario: App exits during commit
- **WHEN** the app next launches with an incomplete committing journal
- **THEN** it presents a recovery state before starting another migration and can resume idempotently or restore backed-up destination data

#### Scenario: Destination changed after partial import
- **WHEN** rollback finds a path whose identity or hash no longer matches the operation's expected created/replaced object
- **THEN** rollback preserves that object, stops unsafe deletion, and reports manual recovery rather than deleting by path alone

#### Scenario: User cancels during commit
- **WHEN** cancellation is requested after final mutations began
- **THEN** the UI waits for the current atomic step, runs rollback, and reports whether destination data was fully restored

### Requirement: Verified completion and actionable report
The system SHALL verify committed file hashes, runtime record readability, reference integrity, and index refresh before success, and SHALL provide a local report of imported, deduplicated, skipped, renamed, unresolved, disabled, backed-up, and failed items.

#### Scenario: Import completes with warnings
- **WHEN** optional entries were skipped or integrations remain disabled but all committed data verifies
- **THEN** the result is “Completed with items to review” rather than unqualified success and links to each repair action

#### Scenario: Verification finds missing attachment
- **WHEN** a committed history references an attachment that cannot be read
- **THEN** the operation is not reported as fully successful and follows the defined rollback or partial-recovery policy with an explicit error code
