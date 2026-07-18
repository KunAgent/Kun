## Why

Kun currently persists a user's projects, conversation history, attachments, design/write artifacts, and UI registries across several machine-local stores. Users need a supported way to move that work from one computer to another, including across Windows, macOS, and Linux, without manually copying hidden directories or leaving historical sessions bound to paths that only exist on the source machine.

## What Changes

- Add a Settings -> Data Migration entry for exporting and importing a portable Kun migration package.
- Export selected workspaces together with their related Kun threads, session/event history, attachments, Design/Write artifacts, and portable application metadata into a versioned, checksummed archive.
- Exclude secrets, device credentials, logs, caches, binaries, temporary files, Git worktrees, and other unsafe or regenerable machine-local state by default; report every exclusion before export.
- Add import preflight that validates package integrity and compatibility without mutating destination data, then lets the user map each source workspace to a safe destination folder.
- Rebind stored Windows, macOS, and Linux path references by semantic workspace identity and relative path instead of blind string replacement.
- Add explicit merge, keep-both, replace, and skip decisions for workspace/thread conflicts, with conservative defaults and collision-safe ID remapping.
- Make import transactional and resumable, with disk-space checks, staging, rollback, a final report, and an auditable path-remapping/exclusion record.
- Treat imported projects as untrusted on the destination device: trust grants, approvals, OAuth sessions, provider credentials, runtime tokens, and scheduled/external actions are never activated by the package.

## Capabilities

### New Capabilities

- `data-migration-package`: Defines selectable, portable, versioned, integrity-checked export packages and the data/security inclusion policy.
- `data-migration-import`: Defines non-mutating preflight, cross-platform path rebinding, conflict handling, transactional import, recovery, and compatibility behavior.
- `data-migration-settings-ui`: Defines the Settings user journey for export, import, progress, decisions, accessibility, warnings, and completion reports.

### Modified Capabilities

None.

## Impact

- Renderer: a new Settings category and export/import wizard, plus migration state/progress/report views and localized copy.
- Shared/preload/main: typed migration IPC contracts, native file/folder pickers, archive streaming, path normalization, safe extraction, disk-space and file-system checks, and renderer storage snapshot/restore.
- Kun runtime: quiesce/snapshot and import endpoints or services for thread/session stores, attachments, artifacts, memory references, and index rebuilding without adding another runtime.
- Persisted data: a new migration package schema and migrators independent of raw on-disk layout; imported settings and histories may receive new thread IDs and destination workspace paths.
- Dependencies/tests: a maintained archive implementation with ZIP64/streaming and path-safety support, schema fixtures for each package version, cross-platform path fixtures, failure-injection tests, and packaged-app smoke coverage.
