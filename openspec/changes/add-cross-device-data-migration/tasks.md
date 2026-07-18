## 1. Product Decisions and Shared Contracts

- [x] 1.1 Encode the approved v1 defaults for optional encryption, `.git` presets, seven-day backup retention, the reserved enterprise policy gate, and optional disabled workflow/schedule import
- [x] 1.2 Add `src/shared/data-migration.ts` schemas for package versions, workspace/thread catalogs, selections, estimates, path/ID references, conflicts, plans, operations, progress, reports, and stable error codes
- [x] 1.3 Add shared hard-exclusion, sensitive-name, Complete preset, and Smaller package preset policy definitions with unit tests
- [x] 1.4 Add source-platform path parsing and package-relative path types that cannot represent absolute archive entry paths
- [x] 1.5 Add versioned typed path/reference descriptors for thread, session, event, attachment, Design, Write, plan, SDD, workflow, schedule, and renderer registry records
- [x] 1.6 Add format/component version migrator interfaces and immutable v1 fixture conventions

## 2. Package Container, Integrity, and Encryption

- [x] 2.1 Select and add a maintained streaming ZIP64 dependency after license, Electron packaging, path-safety, and large-file evaluation
- [x] 2.2 Implement `.kunpack` magic header, envelope parser/writer, manifest/catalog/checksum schemas, and deterministic catalog serialization
- [x] 2.3 Implement bounded streaming ZIP64 creation and reading without buffering whole entries or archives
- [x] 2.4 Implement per-entry SHA-256, catalog/checksum binding, expanded byte accounting, and final package reopen verification
- [x] 2.5 Implement scrypt parameter validation and passphrase-derived key handling that never persists/logs secrets
- [x] 2.6 Implement independently authenticated bounded AES-256-GCM frames with unique nonces and published test vectors
- [x] 2.7 Implement wrong-password, truncated-frame, modified-frame, modified-manifest, and unencrypted-integrity tests

## 3. Kun Runtime Export Snapshot

- [x] 3.1 Define Kun migration snapshot contracts and authenticated `/v1/migrations/exports` create/stream/release routes
- [x] 3.2 Add a selected-thread snapshot barrier that waits, explicitly interrupts, or omits running turns without globally stopping Kun
- [x] 3.3 Normalize running status, pending approval, pending user input, and background execution state into safe historical export records
- [x] 3.4 Serialize canonical thread/session/messages/events/usage/goals/todos and lineage without copying runtime indexes
- [x] 3.5 Compute reachability for selected attachments, artifacts, memory, fork/side/child histories, and deduplicate content IDs
- [x] 3.6 Apply runtime hard exclusions for credentials, OAuth, secret keys, logs, observability, temporary state, opaque extension data, and non-selected scoped content
- [x] 3.7 Add snapshot expiration, cleanup, mutation-fence, malformed-history, and concurrent-delete tests

## 4. Export Inventory and Workspace Packaging

- [x] 4.1 Implement main-process inventory of Code, Design, Write, settings, workflow/schedule, and renderer-registry workspace roots with canonical overlap detection
- [x] 4.2 Implement streamed file-tree estimation with counts, logical bytes, sensitive-name findings, known regenerable classifications, and cancellation
- [x] 4.3 Implement safe workspace traversal that does not follow external links, junctions, reparse points, devices, sockets, FIFOs, or migration output/staging paths
- [x] 4.4 Implement nested workspace ownership and package workspace ID assignment so overlapping files are not duplicated silently
- [x] 4.5 Implement pre/post file identity checks, bounded retry, unstable-file decisions, POSIX mode/timestamp capture, and large/sparse-file accounting
- [x] 4.6 Implement allowlisted portable settings and semantic renderer-state export through normal owners rather than raw profile/localStorage copying
- [x] 4.7 Implement sanitized optional workflow/schedule definition export with active/channel/credential state removed
- [x] 4.8 Implement the export orchestrator that streams runtime snapshot, workspace payloads, catalogs, reports, compression, optional encryption, verification, and atomic final publish
- [x] 4.9 Add export cancellation/cleanup and reject output paths inside selected workspaces, staging, backup, or existing protected destinations

## 5. Package Inspection and Archive Security

- [x] 5.1 Implement header-only identification and passphrase challenge without extracting payload data
- [x] 5.2 Implement non-mutating manifest/component version validation and supported staged migrator execution
- [x] 5.3 Implement archive entry normalization and rejection for zip-slip, absolute/drive/UNC paths, ADS/device names, ambiguous duplicate names, and undeclared entries
- [x] 5.4 Implement limits for entry count, metadata record size, expanded bytes, compression ratio, frame size, and actual available disk
- [x] 5.5 Implement safe link metadata validation including loops, external targets, target type conflicts, and destination capability checks
- [x] 5.6 Build malicious/corrupt `.kunpack` fixtures and fuzz/property tests for parsers, entry normalization, and budget enforcement

## 6. Cross-Platform Import Planning

- [x] 6.1 Implement destination file-system probing for case sensitivity, Unicode normalization, legal names, component/path length, writable status, and link support
- [x] 6.2 Implement workspace ID to destination-root planning with collision-free new-folder recommendations and explicit skip/unmapped handling
- [x] 6.3 Implement Windows drive/UNC, macOS, Linux, and home-path parsing fixtures and destination-platform path construction
- [x] 6.4 Implement preflight detection for case/Unicode collisions, Windows reserved names/ADS, path length, file/directory conflicts, and unsupported file types
- [x] 6.5 Implement typed operational path rebinding and unresolved external-reference reporting without changing free-form text or file contents
- [x] 6.6 Implement stable explicit rename/skip maps and warnings that arbitrary code references cannot be repaired
- [x] 6.7 Implement per-target staging/backup/safety-margin disk estimates and repeatable import operation plans

## 7. Workspace Conflict Resolution and Staging

- [x] 7.1 Implement Keep both with collision-free destination naming as the default workspace policy
- [x] 7.2 Implement Merge classification for missing, identical-hash, differing-content, and file/directory type conflicts
- [x] 7.3 Implement explicit keep-target, imported-sibling, replace-with-backup, and skip decisions with directory-level bulk rules
- [x] 7.4 Implement same-volume hidden staging roots with permission hardening, bounded extraction, verified entry hashes, and cleanup
- [x] 7.5 Implement safe restoration/materialization policy for internal relative symlinks and stripping of unsafe POSIX permission bits
- [x] 7.6 Add tests for read-only/network/removable volumes, disk-full staging, million-entry/small-file workloads, and source-to-target path edge cases

## 8. Kun Runtime Import and ID Remapping

- [x] 8.1 Define `/v1/migrations/imports/preflight`, commit, verify, and rollback contracts and add a scoped runtime migration maintenance lock
- [x] 8.2 Validate staged canonical runtime records and component schemas without mutating active stores
- [x] 8.3 Implement canonical thread hashing, exact deduplication, different-content ID allocation, and one operation-wide thread/reference ID map
- [x] 8.4 Rewrite typed thread lineage, events, attachment scopes/local paths, artifacts, memory, and renderer registry references consistently
- [x] 8.5 Import histories additively through store/service boundaries, rebuild the hybrid index from canonical records, and avoid overwriting different existing threads
- [x] 8.6 Preserve readable historical provider/model metadata while requiring explicit configured provider/model selection for new turns when unavailable
- [x] 8.7 Verify imported session/event replay, goals/todos, attachment/artifact readability, memory scope, and fork/side/child lineage
- [x] 8.8 Implement runtime rollback that removes only records introduced by the operation and is idempotent across retries

## 9. Application State Restore and Trust Reset

- [x] 9.1 Apply portable settings through the settings store allowlist without replacing destination provider, Kun runtime, terminal/editor, port, path, or credential configuration
- [x] 9.2 Restore Design, Write, plan, SDD, fork, thread, composer, and workspace registries through versioned semantic adapters and operation ID/path maps
- [x] 9.3 Import workflow definitions without auto-running them and import schedule definitions disabled with channel bindings cleared
- [x] 9.4 Mark imported workspaces untrusted and ensure hooks, commands, extensions, schedules, workflows, Connect channels, and external actions do not activate automatically
- [x] 9.5 Add post-import refresh/reload coordination so workspace lists and histories appear without copying the Chromium profile
- [x] 9.6 Add hard-deny regression tests proving secrets, OAuth, runtime tokens, keys, approvals, trust grants, and active triggers cannot be restored

## 10. Transaction Journal, Recovery, and Reports

- [x] 10.1 Implement a durable migration operation journal with inspected, staged, committing, rolling-back, completed, and failed phases
- [x] 10.2 Record each idempotent file/runtime/settings mutation and its expected pre/post identity before performing it
- [x] 10.3 Coordinate multi-target commit order, same-volume atomic renames, conflict backups, runtime maintenance, application-state apply, and final verification
- [x] 10.4 Implement phase-aware cancellation: discard inspection, clean staging, or finish the current atomic mutation and roll back
- [x] 10.5 Detect incomplete journals at startup and implement resumable commit and identity-checked rollback across repeated crashes
- [x] 10.6 Preserve independently modified destination paths during rollback and emit manual-recovery steps instead of deleting by path alone
- [x] 10.7 Implement immutable local export/import reports with mappings, exclusions, conflicts, deduplication, disabled items, backups, warnings, timings, and sanitized error codes
- [x] 10.8 Implement backup retention and disk-pressure cleanup using the approved product policy without removing an active/recoverable operation

## 11. Main, Preload, and Renderer Integration

- [x] 11.1 Add typed IPC handlers for estimate, native file/folder selection, inspect, plan, start export/import, cancel, recover, report, and status
- [x] 11.2 Add a constrained `window.kunGui.dataMigration` preload bridge and rate-limited progress subscription with listener cleanup
- [x] 11.3 Add `dataMigration` to Settings route/category types, deep-link routing, sidebar icon/label, section registry, and lazy loading
- [x] 11.4 Build the Data Migration landing section with Create/Select cards, never-transferred notice, recent reports, and incomplete-operation priority
- [x] 11.5 Build export Scope, Contents and security, Review, Create, and Report step views with estimates, sensitive acknowledgements, passphrase handling, and running-thread decisions
- [x] 11.6 Build import Select, Inspect, Map workspaces, Resolve, Review, Import, and Report step views with virtualized large inventories and conflict bulk actions
- [x] 11.7 Add application-level persistent progress/return UI and enforce a single active mutation operation
- [x] 11.8 Add Chinese and English strings, keyboard/focus behavior, live-region progress, non-color status semantics, and destructive-decision confirmations
- [x] 11.9 Add actionable error/recovery views that state phase, stable code, destination impact, rollback result, and next action without exposing raw stack traces

## 12. Testing, Packaging, and Rollout

- [x] 12.1 Add shared/unit tests for schemas, policies, version migrators, path/reference transforms, manifest determinism, and report sanitization
- [x] 12.2 Add main-process integration tests for export, inspect, staging, conflict strategies, journal recovery, rollback, disk/permission failures, and repeated import
- [x] 12.3 Add Kun integration tests for live snapshot fencing, runtime import preflight/commit/rollback, ID collisions, replay, indexes, and reachable content
- [x] 12.4 Add renderer tests for routes, landing cards, step validation, disabled reasons, progress/cancellation, recovery, completion variants, i18n, and accessibility
- [x] 12.5 Add performance tests that assert bounded memory and responsive progress for large files, large JSONL histories, and high entry counts
- [x] 12.6 Add automated Windows/macOS/Linux source-path and destination-file-system matrix fixtures, including case, Unicode, reserved-name, long-path, and link cases
- [x] 12.7 Run `npm run typecheck`, relevant Vitest suites, `npm run build:kun`, `npm run build`, and `git diff --check`, separating new failures from baseline failures
- [ ] 12.8 Execute packaged-app manual smoke tests for all nine same/cross-OS directions covering new target, Keep both, Merge, collision, encryption, cancel, crash recovery, and rollback
- [ ] 12.9 Release behind a feature flag to internal dogfood, retain v1 fixture packages permanently, and enable broader channels only after security review and recovery gates pass
- [x] 12.10 Document the user migration guide, no-password-recovery warning, exclusion policy, cross-platform limitations, and support report workflow
