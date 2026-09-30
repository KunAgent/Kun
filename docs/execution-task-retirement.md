# Execution tasks and TodoWrite retirement

## Availability boundary

Kun advertises `task_create`, `task_update`, `task_get`, and `task_list` for
execution-step tracking. `todo_write`, `todo_list`, and the independent
`task_graph` tool are no longer registered, including after configuration
reload. Imported skill allowlists cannot resurrect their aliases.

The embedded Claude SDK explicitly excludes and rejects `TodoWrite` and its
SDK-local `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList` ledger. Kun's bridged
tools remain available through the normal capability and permission gates.
Existing SDK transcript events remain readable. Historical Cursor checklist
events also remain readable, but no longer write Kun's retired todo ledger.

An already-running older application keeps its loaded code until shutdown;
this change does not hot-swap its tool implementation mid-call. On the new
runtime, resumed history is preserved, but stale calls to retired tools fail
instead of being translated into incompatible atomic updates.

## One canonical execution-step aggregate

`ExecutionTaskService` persists `ThreadRecord.executionTasks` using the
existing manager-owned ThreadStore and optimistic conditional writes. It does
not introduce a second physical writer or a new scheduler. The aggregate has
a schema version, revision, task records, migration marker and request receipts.
Task records have stable IDs, independent revisions, owners, dependencies,
acceptance criteria, reasons, evidence and optional execution/source bindings.

The existing TaskGraph implementation supplies cycle checks and dependency
readiness. It no longer owns an independently mutable per-thread graph file.
The aggregate supports up to 2,000 steps, while model queries are paginated at
100 records per page. Cursors are bound to the aggregate revision; a concurrent
change requires restarting pagination rather than silently skipping records.

Domain boundaries remain separate:

- Goal: the full objective, budget and completion policy
- ExecutionTask: a concrete step and its progress
- RoomTask, Job and Run: actual execution, attempts and executor lifecycle
- Commitment: a cross-conversation promise and its acceptance evidence

Task creation, readiness, waiting and completion do not start an agent, create
a reminder, resume a process, complete a Goal, or cancel a linked RoomTask.
Task bookkeeping is excluded from the Goal no-progress reset. This PR does
not depend on the separate AgentCommitment feature or change its `task` link
kind, which refers to RoomTaskExecution.

## Atomic API and safety

- `task_create`: a stable `clientRequestId`, title and optional dependencies,
  owner, priority and acceptance criteria
- `task_update`: task ID, `clientRequestId`, `expectedRevision` and only the
  fields being changed; omitted fields never receive create-time defaults
- `task_get`: one task including its current revision
- `task_list`: bounded filtering and pagination, optionally ready work

Identical retries do not create another task or apply the mutation again.
A retry returns current task state with `replayed: true`; it need not return
the historical response if the task has subsequently changed. Reusing an
accepted request ID with different arguments fails. Concurrent updates to
different tasks preserve each other; competing updates to one revision have
one winner. The store's CAS also protects concurrent thread metadata changes.

The HTTP equivalent is GET/POST `/v1/threads/:id/tasks` and GET/PATCH
`/v1/threads/:id/tasks/:taskId`. Normal runtime authentication is mandatory.
Whole-list POST and DELETE `/todos` return 410. Existing individual and board
status controls use a narrow canonical adapter with replay receipts, never a
replacement list.

Owners are the current thread or an existing same-workspace direct child.
A child can query and update only its assigned parent-scoped tasks. Only the
active owning turn can claim `running`; each owner has one running step.
Distinct eligible owners can run concurrently. Stale/deleted actors fail
closed. Dependency cycles, missing/self/duplicate dependencies and completion
before dependencies succeed are rejected.

Statuses distinguish pending, running, waiting, blocked, paused, succeeded,
failed and cancelled. Waiting/blocking/pausing/failure require a reason;
success requires evidence. Terminal steps are immutable as outcomes: create a
follow-up rather than silently reopening a finished task.

A UI/other actor cannot claim that a running step stopped. Stop the executor
through its existing controls first. Turn settlement reconciles unfinished
running steps to paused, clears the execution binding and publishes progress.
Reads also reconcile interrupted execution. Neither path starts another turn.

## Migration and historical rendering

Migration imports both the old `thread.todos` and hashed `task-graphs` file.
It persists the result once. Original snapshots/files and original historical
tool calls/results are not rewritten or deleted. Same-title records from
different sources are not guessed to be duplicates. Corrupt, cyclic or
oversized legacy input fails without overwriting it.

Old running steps become paused. Retrying legacy steps with prior attempts or
a deferred retry time also require explicit recovery. `legacyGraphPolicy`
retains attempts, retry limits/time, worktree, token budget, original failure
and graph concurrency as read-only context; those fields never schedule work.

Forks preserve task content but rebind ownership, clear execution/receipts and
pause inherited running work. The original thread is unchanged.

The `todos` response and `todos_updated` event remain compatibility display
projections. They include canonical task status/revisions and are derived
from executionTasks, including in SQLite/sidebar indexes. They are not a
second authoritative ledger. New UI snapshots are monotonic by revision;
older, duplicate or unrevisioned history cannot overwrite newer task state.
Canonical task failure/cancellation never renders as successful completion.

Downgrading a migrated data directory to software that does not understand
executionTasks is unsupported. Keep the normal data backup; rollback must use
an execution-task-aware build. Do not re-enable legacy whole-list writes or
dual-write old and new ledgers as a rollback strategy.

## Saved plans

Saved plan checkboxes import structure and initial state; subsequent document
edits do not overwrite accepted task progress. Task titles can change without
renaming the source document label. Source identity includes the original
label, ordinal and a structural document fingerprint that excludes checkbox
completion markers. Repeated labels remain distinct.

Task status projects back only when that source identity still matches.
Missing/ambiguous/reordered source data reports a projection conflict after
the canonical task commit. The same idempotent request can repair projection
after reconciliation. It never checks an unrelated line by ordinal fallback.

Removed plan steps retain history and become source-stale. They are not
runnable or completable until reconciled; cancelling them does not recreate
the removed line. This also applies when the plan removes every checkbox.

State is authoritative if event or plan publication fails after commit.
Create/update, board transitions and plan-import retries repair publication.
A read-only migration retry returns the canonical snapshot; detail refresh
also recovers it, rather than emitting a full-list event on every read.

## TUI and validation

`/tasks` uses atomic task APIs for list/add/edit/done/pending/cancel/priority.
`delete` cancels rather than destroying history. Synthetic `start`, whole-list
`clear` and positional list `move` explain the corresponding ownership/atomic
boundary instead of falling back to retired writes.

Regression coverage includes actual runtime composition and hot reload,
authenticated HTTP and desktop transport, SDK restricted/full-access/resume
boundaries, persistence/restart, CAS and receipt recovery, owner isolation,
source migration, duplicate/removed plan steps, lifecycle recovery, sidebar
projection, UI version ordering, historical rendering and TUI commands.

Manual native UI/platform acceptance and provider-backed SDK integration are
separate from deterministic automated tests; a passing local test suite alone
does not establish those environments were exercised.
