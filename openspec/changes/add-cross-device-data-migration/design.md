## Context

Kun is an Electron desktop application with a single bundled Kun runtime. Its user-visible state is not one directory that can safely be copied:

| State family | Current owner / examples | Migration concern |
| --- | --- | --- |
| Workspace content | Code roots, `~/.kun/write_workspace`, Design roots, `.kun-design/`, `.kunsdd/`, `DESIGN_SYSTEM.md` | Large mutable trees, links, Git metadata, platform-specific names and permissions |
| Runtime history | `{dataDir}/threads/*`, canonical thread/session JSON and JSONL, `index.sqlite3` | Active writers, schema evolution, thread ID collisions, absolute paths in structured records |
| Runtime content | `{dataDir}/attachments`, `artifacts`, `memory`, child-run/thread lineage | Reachability, deduplication, path-scoped authorization, content integrity |
| Application state | `kun-settings.json`, workflow/schedule definitions, renderer registries in Chromium localStorage | Mixes portable preferences with device paths, credentials, thread IDs, and workspace IDs |
| Device-only state | provider secrets, OAuth, runtime tokens, `secret.key`, extension credentials, logs, caches, models, binaries | Must not be transferred or silently activated |

Raw directory copying would race live writers, couple the feature to internal file layouts, copy indexes and encryption keys that are not portable, and leave source absolute paths in operational fields. The migration feature therefore needs a stable logical package format and explicit owners for serialization.

The primary stakeholders are users changing computers, IT/support teams moving managed installations, and maintainers who must evolve the runtime store without invalidating old packages. The detailed product behavior is in `prd.md`; normative behavior is split across the three capability specs.

## Goals / Non-Goals

**Goals:**

- Move selected projects and their useful Kun context between Windows, macOS, and Linux with one export file and an in-app import flow.
- Preserve workspace files, conversation readability and lineage, attachments, Design/Write artifacts, timestamps, goals/todos, and portable registries.
- Make path conversion explicit, reviewable, and based on workspace identity plus package-relative paths.
- Prevent a failed, cancelled, corrupt, or malicious import from damaging destination data or escaping chosen directories.
- Never transfer or reactivate device credentials, trust decisions, pending approvals, or external automations.
- Support large packages with bounded memory, progress, cancellation, recovery, and useful diagnostics.
- Decouple package compatibility from current raw disk layout through versioned schemas and migrators.

**Non-Goals:**

- Cloud backup, account sync, peer-to-peer transfer, or continuous/two-way synchronization.
- Bit-for-bit cloning of the application profile or operating-system environment.
- Moving installed binaries, local models, dependency caches, Git worktrees, running processes, terminal state, or editor installations.
- Migrating provider/API credentials, OAuth sessions, OS keychain items, channel tokens, runtime tokens, or workspace trust grants.
- Guessing replacements for arbitrary absolute paths embedded in source code, prose, shell output, or unknown extension payloads.
- Making an incompatible file tree fully functional on a target file system that cannot represent its names, case distinctions, links, or permissions.
- Opening or executing imported projects, hooks, tasks, extensions, or commands automatically.

## Decisions

### 1. Use a logical `.kunpack` package, not a raw profile backup

The user-facing file is a versioned `.kunpack` envelope containing a ZIP64 payload. ZIP64 provides compression, streaming, and large-file support; the Kun envelope provides a fixed magic header, package format version, optional encryption metadata, and room to change the payload format later.

The payload uses only `/` separators and contains:

```text
manifest.json
catalog/workspaces.json
catalog/threads.json
catalog/portable-settings.json
catalog/renderer-state.json
payload/workspaces/<workspace-id>/<relative-path>
payload/runtime/snapshot.jsonl
reports/export-report.json
checksums.jsonl
```

`payload/runtime/snapshot.jsonl` is the Kun-owned canonical stream for selected threads, sessions, items, events, reachable attachments/artifacts, and memory. Attachment and artifact metadata use ordinary bounded records; their bytes are emitted as ordered 1 MiB Base64 chunks with declared byte size and SHA-256 so a near-limit attachment never creates an oversized JSONL record. The importer validates sequence, length, digest, and content-addressed metadata before mutating stores, while retaining read compatibility for v1 packages that used an inline content record.

`manifest.json` carries `formatVersion`, `minimumReaderVersion`, package/source IDs, app/runtime versions, source OS/architecture, created time, selection policy, counts, logical component schema versions, expanded byte count, and the SHA-256 digest of every catalog/checksum stream. Each payload entry has a SHA-256 hash, size, classification, and owning logical ID. ZIP CRC is not treated as sufficient integrity checking.

The package stores canonical records rather than `index.sqlite3`, runtime caches, or raw Chromium profile databases. Destination indexes are rebuilt. This avoids file locks and allows import-time schema migration.

Alternative considered: zip the workspace, runtime data directory, and Electron profile verbatim. Rejected because it cannot provide consistency, selective security policy, cross-platform rebinding, or forward-compatible import.

### 2. Keep serialization with the layer that owns the data

- The renderer owns the user flow only. It never reads archives or runtime storage directly.
- Shared types and schemas in `src/shared/data-migration.ts` define selections, estimates, plans, conflicts, progress, reports, and error codes.
- Preload exposes a narrow `window.kunGui.dataMigration` bridge. It supports estimate, native pickers, inspect, plan, start, cancel, resume/rollback, report, and a progress subscription.
- The Electron main process owns native dialogs, archive/encryption streams, workspace traversal, renderer portable-state capture, staging journals, disk checks, and cross-volume commit coordination.
- Kun owns canonical runtime snapshot and import services behind authenticated local HTTP routes. Main uses a dedicated streaming migration client instead of importing runtime storage classes or copying `dataDir` while Kun is live.

Proposed runtime surface:

- `POST /v1/migrations/exports` creates an immutable, expiring logical snapshot after selected threads are quiescent.
- `GET /v1/migrations/exports/{snapshotId}` streams the snapshot catalog and entries.
- `DELETE /v1/migrations/exports/{snapshotId}` releases it.
- `POST /v1/migrations/imports/preflight` validates staged runtime records and returns ID/provider/schema decisions without mutation.
- `POST /v1/migrations/imports/{operationId}/commit` imports remapped records while the runtime holds a migration maintenance lock.
- `POST /v1/migrations/imports/{operationId}/rollback` removes records introduced by an incomplete commit.

These routes extend the existing Kun HTTP boundary and do not introduce a second runtime or a diagnostics surface.

Alternative considered: stop Kun and have Electron copy raw files. Rejected because Electron would become coupled to hybrid/file-store internals and future store migrations.

### 3. Make inclusion policy explicit and classify every item

The export review groups data into user-understandable categories:

| Category | Default | Notes |
| --- | --- | --- |
| Selected workspace regular files, including `.kun-design`, `.kunsdd`, and Write documents | Included | Hidden files are included; users can apply a size-optimization preset |
| Conversation/thread/session history, events, goals/todos, usage | Included | Active work is quiesced; gates are normalized |
| Attachments and artifacts reachable from selected histories/workspaces | Included | Content-addressed and deduplicated |
| Portable UI preferences and semantic registries | Included | Allowlisted keys only; IDs and workspace references are remapped |
| Memory scoped to selected workspaces/threads | Optional, selected by default | Imported records are untrusted context and path-remapped |
| Workflow and schedule definitions | Optional | Imported schedules are disabled and channel bindings cleared |
| `.git` repository metadata | Included in Complete preset | Credential-looking remote URL userinfo is flagged; Git worktree admin directories outside the root are never followed |
| Known regenerable trees such as `node_modules`, `.venv`, build output, and caches | Included in Complete; excluded in Smaller package preset | Exact exclusions are shown before export |
| Workspace secret-looking files such as `.env`, private keys, and credential files | Included only after a sensitive-content acknowledgement | The package cannot guarantee content-level secret detection |
| Provider/API secrets, OAuth, runtime tokens, key material, trust/approval state | Hard excluded | Cannot be overridden |
| Logs, observability traces, crash reports, binaries, local models, caches, temporary/staging files | Hard excluded | Regenerable or privacy-sensitive |
| Extension packages and opaque extension data | Excluded in v1 | Definitions/IDs may be reported; future extensions require versioned migration adapters |

The exporter produces a machine-readable and human-readable exclusion report. A Complete preset aims at project fidelity, while a Smaller package preset suggests known regenerable exclusions; neither can override hard exclusions. Optional passphrase protection is prominently recommended whenever workspace content or histories are included.

Alternative considered: always exclude every file that resembles a secret. Rejected because heuristic removal silently breaks projects and cannot reliably identify secrets. The design uses warnings, explicit acknowledgement, hard exclusion of Kun-owned credentials, and optional encryption.

### 4. Encrypt with a Kun envelope when the user supplies a passphrase

Unencrypted packages are permitted for local/offline workflows but show a persistent warning. Encrypted packages use a passphrase-derived key (scrypt with parameters and random salt stored in the header) and independently authenticated AES-256-GCM frames with unique nonces and bounded frame size. The passphrase and derived key are never persisted or logged. A wrong passphrase fails before payload inspection; there is no recovery mechanism.

Checksums detect accidental corruption in unencrypted packages but do not prove provenance. Every package, including an encrypted/authenticated one, is treated as untrusted input and is never executed.

Alternative considered: OS keychain encryption. Rejected because a device-bound key cannot decrypt on the destination computer.

### 5. Snapshot runtime state and detect workspace drift

Export has two consistency domains:

1. Kun places selected threads behind a short snapshot barrier. Running turns must finish, be interrupted by explicit user action, or be omitted. The snapshot normalizes `running` threads to `idle`, converts pending approvals/user inputs into non-actionable historical states, and prevents late writers from changing the captured revision.
2. Arbitrary workspace files cannot be globally frozen. Each file is opened without following unsafe links, hashed while streaming, and compared with its pre/post stat identity. Changed files are retried a bounded number of times. Persistent churn blocks that file or the package according to the user's review decision, and the export report names it.

The destination package path cannot be inside a selected workspace or a migration staging tree, preventing recursive self-inclusion. The exporter streams entries and never holds an entire workspace, archive, or JSONL history in memory.

Alternative considered: require the entire application to quit for export. Rejected for poor usability and because external editors can still change workspace files. Import does use a scoped maintenance phase because destination mutation must be fenced.

### 6. Rebind paths through a typed reference registry

Every selected source root receives a random package `workspaceId`. Package file entries are addressed only as `workspaceId + relative POSIX path`. The import plan maps each `workspaceId` to a user-approved absolute destination root.

Path transformation is schema-driven. Known operational fields are rewritten, including:

- thread/session workspace roots and structured turn context;
- attachment `localFilePath` and workspace authorization scopes;
- known built-in tool arguments/results and event fields declared as paths;
- Design, Write, plan, SDD, fork, and thread registries;
- allowlisted settings, workflow definitions, and disabled schedule definitions;
- thread lineage and thread IDs referenced by those records.

Free-form chat text, code, prose, terminal output, and unknown extension blobs are not globally searched/replaced. Source paths in those fields remain historical evidence. Known absolute paths outside all selected roots become unresolved references; the related feature is disabled or shown with a repair action rather than guessed.

Windows drive letters, UNC roots, POSIX roots, and home-directory syntax are parsed using the source platform declared by the package, never by the destination's `node:path` default. Destination paths are built with the destination platform API. Package entry names never contain drive letters or absolute roots.

Before extraction, the importer models destination file-system behavior and detects:

- case-fold and Unicode-normalization collisions;
- Windows reserved names, alternate data streams, trailing spaces/dots, and invalid characters;
- maximum component/path lengths;
- unsafe symlinks, junctions, absolute links, and links escaping their workspace;
- duplicate archive entries and file/directory type collisions.

The default is to block commit until fatal incompatibilities are resolved. The user can skip an entry, choose a different destination, or explicitly accept a stable renamed copy. Renamed source files are recorded in the path map, with a warning that arbitrary source-code references cannot be repaired automatically. Safe relative internal symlinks are recreated only when supported and permitted; otherwise they are skipped or materialized from an in-package target after explicit review. Device nodes, sockets, FIFOs, and external link targets are never imported. On POSIX, executable bits may be restored but setuid/setgid/sticky bits are stripped; Windows records them only in the report.

Alternative considered: replace `C:\old\root` with `/new/root` in every string. Rejected because it corrupts prose and code, misses alternate spellings/case, and can rewrite data that is not operational.

### 7. Preflight is complete and non-mutating

Selecting a package starts inspection, not import. Inspection streams the header, decrypts if necessary, validates schema support, catalog consistency, entry hashes/sizes, expansion limits, archive path safety, and all workspace/thread references. It also inventories target conflicts and calculates required free space separately for each target file system.

The plan contains:

- package identity, source platform/version, integrity/encryption state, and warnings;
- selected categories, counts, compressed/expanded size, and exclusions;
- one destination mapping and compatibility result per workspace;
- thread collision/provider availability decisions;
- file conflicts and identical-file deduplication;
- unresolved references and disabled integrations/tasks;
- the exact operations, backups, estimated peak disk use, and restart/refresh effect.

No destination workspace, Kun store, settings file, or renderer state is changed until the user confirms this plan.

Archive budgets are enforced both from manifest declarations and observed streams. Validation rejects path traversal, absolute/drive-prefixed names, ambiguous duplicate names, encrypted-entry surprises, unsupported compression, excessive file counts, oversized metadata records, suspicious compression ratios, expanded-byte overruns, and any entry not declared in the catalog/checksum set.

### 8. Prefer additive conflict behavior and journaled commit

Workspace destinations default to a new folder named from the source workspace. If that folder exists, the recommended action is Keep both with a numbered destination. Merge is opt-in:

- missing target file: add imported file;
- identical content hash: deduplicate and keep target metadata;
- different content: keep target by default; user may save imported sibling, replace with backup, or skip;
- directory/type conflict: requires explicit resolution.

Runtime histories never overwrite different destination histories. A colliding thread ID with identical canonical content is deduplicated. A different history receives a new thread ID, and all typed lineage/registry/attachment references are rewritten through the operation's ID map. Imported provider/model labels remain historical; if a provider/model is unavailable, the thread is readable but starting a new turn requires an explicit destination provider/model choice.

Import has four durable phases recorded in a local operation journal:

1. `inspected`: immutable plan and user decisions are persisted.
2. `staged`: validated entries are written under per-target hidden staging directories on the same file system as their final destinations.
3. `committing`: destination conflicts are backed up and idempotent rename/copy operations are recorded before execution; Kun applies its additive runtime transaction under a maintenance lock.
4. `completed`: indexes are rebuilt, renderer registries/settings are applied through normal stores, backup retention is scheduled, and the final report is written.

Atomicity across several disks is impossible, so the journal provides recoverable all-or-nothing semantics at the product level. On cancellation or crash, startup offers Resume or Roll back. Rollback removes only operation-created paths/records and restores overwritten files from operation backups. User data created independently after the import started is never deleted based only on path; identity and expected hashes must match the journal.

Alternative considered: extract directly into destination folders. Rejected because partial extraction and overwrite failures would be unrecoverable.

### 9. Version package schemas independently from app releases

`formatVersion` is an integer envelope/payload contract. Each logical component also has its own schema version. `minimumReaderVersion` lets exporters declare the minimum importer needed for required semantics.

The importer:

- accepts supported versions even when `sourceAppVersion` is newer;
- upgrades older component records through deterministic, fixture-tested migrators in staging;
- ignores only explicitly optional unknown fields/components and reports them;
- rejects a newer required format/component or missing required capability before mutation;
- never downgrades destination stores or changes the active app version.

Version 1 import/export is introduced behind a feature flag for internal dogfood. Package fixtures become compatibility assets and are never regenerated in place.

### 10. Use an in-page Settings workflow with durable operation state

The reviewed landing-page visual is stored at `assets/data-migration-settings-mockup.png` with editable source at `assets/data-migration-settings-mockup.svg`.

Add `dataMigration` to the settings route/category type and a sidebar row labeled Data Migration with a transfer/package icon. The landing section contains two primary cards: Create migration package and Import migration package. It also explains what is never transferred and lists recent local migration reports.

Export steps are Scope, Contents & security, Review, and Create. Import steps are Select, Inspect, Map workspaces, Resolve, Review, Import, and Report. The workflow replaces the landing content in the main settings pane rather than opening a small modal; large inventories and conflicts need room. Users can leave Settings during hashing/staging and return from a persistent progress banner. Only one mutation operation can run at a time, while inspections may be discarded safely.

Progress uses phase plus item/byte counters and never predicts an exact completion time without enough samples. Cancellation semantics are explicit: immediate during inspection, cleanup during staging, and rollback after the current atomic step during commit. Closing the app does not pretend the operation failed; the journal is recovered next launch.

The UI is keyboard accessible, exposes progress/status to assistive technology, never relies on color alone, supports Chinese and English, and uses precise error codes with user actions. Password fields support reveal while focused but are never retained. Destructive choices require confirmation naming the affected workspace and backup behavior.

### 11. Bound resource use and preserve responsiveness

Archive, hashing, encryption, and extraction use streams with bounded buffers and worker threads where CPU-heavy work would block Electron main. Progress events are rate-limited. Default guardrails include configurable maximum entry count, maximum metadata record size, maximum expanded bytes relative to available disk, maximum compression ratio, and minimum free-space margin.

Required peak free space is calculated per target as staged bytes plus possible conflict backups plus a safety margin. Import cannot start when any target file system is short. Sparse files are accounted by logical size, and free-space checks are repeated before commit. Files larger than a UI threshold are shown explicitly but are not loaded into memory.

### 12. Reports are local, sanitized, and actionable

Every export/import creates an immutable local report with package/operation IDs, versions, counts, hashes, decisions, old workspace aliases, new roots, ID maps, exclusions, unresolved paths, skipped/renamed/conflicting files, disabled tasks/integrations, warnings, durations, and error codes. Reports do not include passphrases, credentials, file contents, or provider secrets. Application logs use hashes/aliases rather than full user paths by default.

Product telemetry, if enabled separately, contains only coarse success/failure phase, source/destination OS family, package size bucket, duration bucket, and error code. It never uploads package names, workspace paths, thread titles, or content.

## Risks / Trade-offs

- [A workspace contains secrets inside ordinary project files] -> Warn on sensitive names, require acknowledgement, recommend passphrase encryption, hard-exclude Kun-owned credentials, and document that full content secret detection is impossible.
- [Workspace files change during export] -> Stream with pre/post identity checks and bounded retry; report or block unstable files instead of silently creating inconsistent content.
- [Case/Unicode/illegal-name mismatch cannot be represented on the destination] -> Detect during preflight and block by default; allow explicit skip/rename with a prominent code-reference warning.
- [Cross-volume commit cannot be physically atomic] -> Use same-volume staging per root, an idempotent journal, backups, identity-checked rollback, and launch-time recovery.
- [Huge repositories or dependency trees make packages slow and large] -> ZIP64 streaming, size estimates, Smaller package preset, visible large-file/exclusion controls, bounded buffers, and cancellable progress.
- [Historical event/tool schemas contain new path fields] -> Central typed path-reference registry with component versions; unknown operational schemas are reported and not blindly rewritten.
- [Imported project code or hooks are malicious] -> Mark workspace untrusted, never auto-open/execute, strip approvals/trust, disable schedules and integrations, and require normal destination trust flow.
- [User expects unavailable provider credentials to move] -> Preview and completion UI explicitly list credentials as excluded and guide reauthentication/model selection.
- [Thread ID collision or duplicate import] -> Use package/operation IDs, canonical hashes, dedupe exact records, remap different IDs, and make commit idempotent.
- [Optional package encryption increases implementation and recovery complexity] -> Use a small documented envelope, standard primitives, test vectors, no password recovery claim, and keep unencrypted packages available with warning.
- [Extension-owned data has no stable schema] -> Exclude opaque extension data in v1 and define a future adapter contract rather than copying it unsafely.
- [Reports and source path hints reveal private metadata] -> Keep reports local, allow deletion, avoid content, and use workspace aliases in logs/telemetry.

## Migration Plan

1. Introduce shared package/IPC/runtime schemas, error taxonomy, path model, fixture corpus, and a disabled feature flag without exposing UI.
2. Implement the read-only inventory/export pipeline and runtime snapshot service. Dogfood same-OS exports and verify packages with an independent inspector.
3. Implement non-mutating package inspection and cross-platform path/file-system fixtures for Windows, macOS, and Linux.
4. Implement additive import into empty destinations, runtime ID remapping/index rebuild, renderer portable-state restore, and final reports.
5. Add merge/replace conflict backup, crash recovery, cancellation, optional encryption, and malicious archive/failure-injection coverage.
6. Expose Settings -> Data Migration to internal users, then staged release channels. Keep v1 fixtures and measure only sanitized success/error metrics.
7. Enable by default after same-OS and all cross-OS matrix smoke tests pass on packaged apps.

Rollback is a feature-flag/UI rollback: existing packages remain readable by the importer, but new exports can be disabled. An in-progress operation is never abandoned by disabling the feature; the recovery screen remains available until it completes or rolls back. No existing application data schema is rewritten merely by shipping the feature.

## Resolved v1 Defaults

- Public v1 includes optional passphrase encryption; unencrypted export remains available only after explicit acknowledgement.
- Complete includes `.git`; Smaller package excludes it. Credential-bearing remote URL userinfo is warned about but repository content is not silently rewritten.
- Conflict backups are retained for seven days by default and can be deleted earlier by the user; disk-pressure cleanup never removes active or recoverable operation data.
- Optional workflow/schedule definitions are supported in v1, with workflows inactive and schedules disabled and unbound on import.
- Enterprise enforcement is not a v1 product surface, but shared contracts reserve a policy gate.

## Open Questions

- What exact extension migration adapter contract is needed for first-party extension data after v1?
- Which enterprise policy source and administration surface should own the reserved migration policy gate in a later change?
