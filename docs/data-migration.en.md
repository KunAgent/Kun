# Kun Data Migration Guide

> 中文：[Kun 数据迁移指南](./data-migration.md)

Settings → Data migration creates a `.kunpack` containing selected workspaces, conversation history, and portable app state. The package can be imported on Windows, macOS, or Linux. Package paths are portable relative paths; the importer maps them to a user-selected destination and validates the target file system's case, Unicode, reserved-name, path-length, and space rules.

## Export

Choose workspaces, Complete or Smaller package, and content categories. Review sensitive-file findings, decide how running conversations are handled, and choose an output path outside all selected workspaces and migration staging/backup directories. Encryption with a passphrase of at least eight characters is recommended. Plaintext packages require an explicit warning acknowledgement.

The passphrase is used only in memory for this operation. It is never stored in settings, logs, reports, or recovery journals, and cannot be recovered if forgotten.

## Import

Select and inspect the package before choosing destinations. Inspection validates format, supported versions, checksums, size budgets, archive paths, and link safety without changing destination data. Map each workspace, then choose Keep both (default), Merge, Replace with backup, or Skip. Resolve file conflicts and review the trust reset before importing.

Kun fully stages and verifies data on each destination volume before commit. Cross-volume changes cannot share one physical file-system transaction, so Kun uses durable journals, idempotent operations, same-volume atomic renames, identity-checked backups, and rollback.

## Included and excluded data

Packages can include workspace files, canonical thread/session/item/event history, reachable attachments, artifacts and memory, Design/Write/Plan/SDD/fork registries, portable UI settings, and workflow/schedule definitions.

API keys, provider credentials, OAuth/account/runtime tokens, keychain data, device identity, key material, trust or approval grants, active processes, terminals, caches, indexes, logs, crash telemetry, channel credentials, webhook secrets, and live external bindings are never included.

Imported workspaces remain untrusted. Hooks, commands, extensions, workflows, schedules, Connect channels, and external actions do not activate automatically. Workflows and schedules are imported disabled with active bindings cleared. Pending approvals and user-input gates become non-actionable expired/cancelled history.

## Cross-platform limitations

Kun rewrites typed workspace paths, thread IDs, attachment scopes, and known registry references. It does not edit paths embedded in source code, documents, or prose. Windows reserved names/ADS/case collisions, macOS Unicode-normalization collisions, target path limits, and unsupported links require an explicit plan decision. Only safe internal relative symbolic links are restored; external links, junctions, reparse points, devices, sockets, and FIFOs are excluded. Unsafe POSIX permission bits are stripped.

Historical provider/model labels remain readable. Starting a new turn requires an explicitly configured destination provider/model when the original is unavailable.

## Cancellation, recovery, and support

Cancellation stops immediately during inspection, removes staging data during staging, or finishes the current atomic step and rolls back during commit. After a crash, the application-level migration banner requires Resume or Roll back before another migration can start.

Rollback removes only operation-created data whose identity still matches the journal. Independently modified paths or records are preserved and listed as manual recovery work. Sanitized reports are stored under the Kun user-data directory at `data-migration/reports/`; they contain stable codes, mappings, counts, exclusions, decisions, and warnings, but no passphrases or credentials. Backups are retained for seven days and active/recoverable data is never removed by disk-pressure cleanup.

## Rollout flag

Development builds enable the feature for internal verification. Packaged builds require `KUN_DATA_MIGRATION_ENABLED=1`; `0` disables new migrations but does not hide recovery for an interrupted operation. Wider rollout remains gated on security review and packaged cross-platform smoke tests.
