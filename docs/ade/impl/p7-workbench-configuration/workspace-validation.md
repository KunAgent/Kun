# Code workspace ownership validation

Date: 2026-09-30. This records implementation evidence for tasks 2.4, 8.4,
16.2, 16.4, and 16.5. It does not replace full desktop or real-Agent acceptance.

## Ownership and admission

The existing Code Git launch control now writes the same frozen workspace
intent consumed by first-message creation. Explicit New and sidebar New create
the thread against the source project first, including the displayed project
revision; only successful admission can allocate a TaskWorkspace. New isolated
tasks no longer also check out a Code pool workspace. Existing pool mappings
remain intact and do not receive a second TaskWorkspace.

The runtime records the selected isolation in the task execution snapshot.
Project isolation defaults are editable, with an explicit current-directory
choice taking priority. Non-Git isolation, missing directories, removed branches,
and missing host capabilities fail visibly without sending in the source tree.

Top-level TaskWorkspace creation reuses the current owner record. Worker unit
workspaces retain their own ownership. Retry calls the existing host retry API
with the original workspace ID, preserving its frozen start point and any
recoverable checkout. Failed preparation keeps input queued.

## Navigation, history, and plans

Selection queries workspaces by owner for an unbound task before draining its
queue. Ready results restore the exact binding; stale lookup and bind responses
cannot overwrite a subsequently selected task. Source-to-execution-path history
mapping remains under the original project.

SQLite summaries retain providerId, harnessId, taskWorkspaceId, and executionUnit.
Old index rows are repaired lazily from metadata, one page at a time, without
loading transcript bodies or scanning every task. A compare-and-set update keeps
newer live index writes, and a projection marker avoids repeated metadata reads.

Direct plan defaults reuse an already isolated task; explicit per-plan worktree
selection remains authoritative. Graph still uses its existing node isolation
without injecting Direct worktree instructions. Automatic planning waits for the
new task workspace binding before reserving its plan path.

## Automated evidence

Renderer coverage includes Code first send, existing empty tasks, project CAS,
non-Git refusal, frozen draft/navigation changes, failed preparation, owner-ready
restoration, historical pool reuse, retry by ID, Automatic workspace reservation,
and Direct/Graph plan behavior. Targeted selection/recovery tests passed:
2 files, 14 tests. Targeted workspace/retry/send tests passed: 3 files, 32 tests.
The Automatic reservation/plan/settings group passed: 4 files, 13 tests.

Kun ownership/service/execution-configuration tests passed: 3 files, 23 tests.
SQLite pagination and legacy-row repair passed under the Electron Node runtime:
2 files, 19 tests. The equivalent system-Node invocation was blocked by an ABI
mismatch: installed better-sqlite3 targeted module version 148 while Node 25
required 141. No test was skipped, and native dependencies were not rebuilt
underneath the desktop smoke process.

Both Web and Kun TypeScript checks passed before the final recovery/index patch.
Final checks and desktop smoke results are recorded by the parent implementation
and UI verification work. All touched authored files remain at or below 700 lines.

The desktop smoke exposed a missing Manager RPC whitelist field: public Code
list requests reached the strict thread-store schema with workbenchScope and
received HTTP 400. The shared Manager list/listPage schema now accepts the Code
scope while retaining workspaceMode and rejecting their combination. A real
remote client -> TCP HTTP Manager router -> shared store regression passed under
Electron Node with one worker. It verifies combined cursor pagination, search,
routing/workspace identities, legacy ADE-only filtering, and invalid scope errors.

A subsequent isolated-profile smoke found that workspace normalization erased
managed task worktrees when HOME lived under the OS temporary directory. Managed
Kun task/branch paths now retain their execution identity; source-project registry
mapping takes priority for the newer task layout. Ready SSE events preserve their
sourceRoot even when they precede the create response. A renderer integration test
runs the public list response through KunRuntimeProvider, the refresh action, and
sidebar grouping using the smoke directory layout. This group passed 5 files and
47 tests; the desktop rebuild/smoke remains the final visual check.

Worker-ready smoke exposed a separate ownership boundary: TaskWorkspace events
are published on the manager thread and carry unitId for worker workspaces.
The parent composer previously tried to bind such a worker workspace, received
`taskWorkspaceId is bound once`, and marked its own preparation failed. Worker
records/events are now excluded from parent prep; ready binding also checks the
thread's existing workspace ID. Selection can repair the old poisoned failed
state from the authoritative parent record. Real event JSON through the renderer
normalizer and sink, plus recovery tests, passed 3 files and 13 tests. They verify
that parent project mapping remains unchanged and its send gate remains open.
