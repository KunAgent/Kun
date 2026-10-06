# Memory revisions, forgetting, and project interchange

## Revisions and review

Canonical JSON remains the single source of truth. A record has a monotonic
`revision` and a bounded tail of prior snapshots (at most 20 revisions and
64,000 serialized characters). The current record and revision tail commit in
one atomic write. Older records are read as revision 1 without a migration that
changes their visibility. History is loaded explicitly when a detail panel is
expanded, rather than included in every management-list response.

Ordinary UI edits and corrections send the observed revision. Agent edits keep
their existing fingerprint fence and commit through the same revisioned store.
Memory mutation tools also use a revision fence. A stale edit fails; it never
silently overwrites a newer correction. Rollback creates another revision and
preserves current ownership/sharing boundaries. Forgotten records cannot be
restored by rollback. The retained history window is finite; missing older
snapshots are not fabricated.

## Three distinct actions

- **Disable:** reversible exclusion from future recall; content and history stay
  available for review
- **Forget:** exclusion from future recall, derived summaries, and capture;
  content remains in a tombstone so its scope/history can be inspected
- **Erase permanently:** requires confirmation of the exact memory ID and its
  current revision. It removes canonical content/history, derived memory
  records, pending/capture payloads, and memory-specific Room receipt snapshots.
  SQLite projections are deleted with secure-delete enabled, then checkpointed,
  vacuumed, and checkpointed again. A busy/failed cleanup is reported as
  incomplete rather than successful

Neither forgetting nor erasure deletes conversation archives, original source
files, historical conversation inputs, or backups. A previously sent message
can still contain the remembered information. These actions are not a claim of
forensic wiping of the underlying disk or third-party copies.

## Restart and recapture protection

A non-content forgetting ledger commits before content is removed. It retains
memory IDs, scoped content digests, source-anchor digests, and erasure operation
IDs. It contains no memory body or source excerpt. Source anchors are independent
of a memory-local evidence ID, so renaming evidence cannot recapture it. Generic
labels such as `memory` are not treated as unique source events.

Forget/erase follows canonical consolidation lineage. Pending ordinary
candidates are scrubbed under the canonical mutation lock; durable run IDs
remain to prevent replay. Agent capture checks barriers when loading, listing,
and applying work. Its payload is replaced with non-content terminal state.
Concurrent in-flight results cannot bypass the canonical barrier.

A barrier-first crash hides records immediately and subsequent canonical reads
finish file removal before rebuilding indexes. Ordinary erasures retain a non-content scope receipt keyed by the memory ID and
observed revision, so the same confirmed request can retry even after canonical
content is gone. Wrong-scope or wrong-revision retries are rejected. Agent
erasure receipts retain all affected IDs, so recovery retries both index cleanup and derivative-only Room
receipts. Completion is recorded only after cleanup succeeds. Conversation
archives and unrelated records are never part of that cleanup.

## Runtime and Manager compatibility

Memory lifecycle requires Manager protocol 6 and the `memory-lifecycle-v1`
capability. Discovery and health must match that protocol exactly before a
Runtime connects or recovers its Manager connection. Protocol-5 clients also
reject protocol-6 discovery, preventing mixed live Runtime/Manager versions
from silently dropping revision fields or bypassing lifecycle operations.
Managers without shared data do not advertise the lifecycle capability.
Existing application ownership, idle retirement, and recovery rules still apply.

This is a live-process compatibility fence, not a downgrade migration. Launching
a wholly old standalone binary against a profile that has used these memory
features is unsupported: old code does not understand the forgetting ledger
and can skip newer records or recapture forgotten content. Neither the protocol
fence nor a record schema version can retroactively add erasure protections to
an old binary. Keep the upgraded Runtime and Manager together when reopening
that profile.

## Optional project Markdown/Git interchange

The existing memory settings include an explicit project-only preview. Export
requires a named project and a selection of approved, active reference records;
personal memory, directives, agent-private records, and inactive records are
excluded. The Markdown manifest retains stable origin IDs for repeated import
preview and compare-and-swap updates. JSON remains canonical; the Markdown file
is an interchange projection, suitable for a manually chosen Git repository.

Import is reviewed before any write. It does not create a Git remote, commit,
watcher, credential, or background sync. Imported evidence is downgraded to
imported trust. Execution receipts in an exported file are informational, not
proof of a new execution; imported scripts or instructions grant no execution
permission or directive authority.

## Verification

The lifecycle suite covers File/FTS stores, concurrent edits, rollback, scope,
source renaming, derivative forgetting, restart and pending recapture barriers,
exact erase confirmation, and raw SQLite/WAL content removal. Failure tests
cover index-removal failure, busy checkpoints, and recovery after canonical
commit but before receipt cleanup. Managed Runtime integration tests start real
authenticated Runtime and Manager HTTP servers against one temporary profile.
They exercise ordinary and Agent revision conflicts, history, rollback,
forgetting, restart, blocked recapture, erasure and retry while a local model
trap asserts zero requests. Structured transport errors preserve scoped
not-found, revision-conflict and incomplete-erasure status without turning
internal failures into missing records.

The native Electron workflow exercises production memory components and real
stores/services in an isolated synthetic profile and publishes its screenshots.
It verifies actual CJK font glyph use before Chinese captures. This fixture does
not launch the production application main/preload/ownership stack.
