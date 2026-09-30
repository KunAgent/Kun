# Review, admission, and Code defaults validation

Date: 2026-09-30. This records evidence for task items 13.1, 13.2, 13.3,
13.5, and 21.3, plus the new Code consumer of Agent Center's default Agent.
It does not claim real-provider execution or complete desktop acceptance.

## Complete review batches

Manager review attachments carry the task workspace ID and immutable request ID.
At both immediate and queued turn admission, Kun checks the workspace owner,
manager target, and stored receipt, then freezes the complete body into the user
item. Model projection appends this dynamic user context outside the immutable
system prefix. Client preview text cannot replace the receipt body.

Legal batches with 200 comments and more than 1 MiB of text are preserved.
Worker batches larger than the dispatch text budget use a content-addressed
artifact with explicit paged read instructions. Lists and send receipts omit
large request bodies. Each batch and the combined review attachments for one
turn have explicit size bounds; oversized input fails instead of truncating.

Send retries retain their client request ID and reviewed revision. Durable
reservations precede delivery, successful receipts survive retries, and corrupt
review files or non-ENOENT read failures cannot be treated as empty history.

## Actual new-work admission

The live global switch and owning task policy now guard runtime execution,
including worker creation, model-originated worker sends, GUI dispatch, and
cross-review requests. HTTP review sends check admission before reserving a
batch; their worker must belong to the reviewed workspace's owner.

Historical `everEnabled` access retains existing-team controls but cannot
permit new work. Worker and Rooms roles and external main-Agent routes cannot
create manager work. Existing dispatch execution, stop, takeover, answer,
verdict, and ordinary manager review preparation remain separate from new-work
admission.

The HTTP regression uses actual ManagerRuntime and file stores. Closing either
the global or task switch produces no new reservation, dispatch, or child.
Stop, takeover, answer, verdict, and manager review preparation remain reachable.

## Task configuration boundaries

The host resolves new task snapshots with field origins. GET/PATCH exposes
current, pending, inherited, revision, and editable-field metadata. Mutations
use object revision checks, reject worker/Rooms self-editing, lock route changes
while a team is active, and reject inconsistent soft/hard limits.

Fresh admission promotes pending routes. New dispatch admission refreshes team
limits and budgets without stopping admitted work. Worker notices read pending
manager-model settings when admitting the next wake-up, preventing stale route
arguments from overriding the promoted snapshot.

## Default Agent in the Code draft

An unsent Code draft now consumes `harnesses.defaultHarnessId` and that Agent's
saved model/source defaults. Priority is explicit user selection, project route,
Kun collaboration, then the default Agent route. Existing threads are unchanged.
Native login drops unrelated Kun provider/account selection. Cursor provider
routes select a Cursor account rather than an HTTP provider.

Unavailable, disabled, or incompatible defaults stay visibly selected with an
error. Sending remains blocked until repair or an explicit replacement, so the
application cannot silently execute using Kun. Draft generation, project
identity, and user-choice checks fence asynchronous defaults. A late initial
settings load cannot overwrite a newer settings-change event.

## Test evidence and remaining checks

- Review/admission/configuration regression: 9 files, 110 tests passed.
- Real HTTP new-work gate plus manager/control/review regression: 8 files,
  112 tests passed. Kun TypeScript and whitespace checks passed at this stage.
- Final default-Agent, project route, frozen send/worktree, and review attachment
  renderer regression: 5 files, 39 tests passed.
- The later duplicate Web TypeScript process was cancelled to release memory;
  the parent implementation owns the final serial typecheck and production build.
- All authored files touched by this subtask remain below 700 lines. The shared
  send orchestration module is 698 lines and should not grow further inline.

Real Agent first/next turns, approvals/cancellation on every Agent transport,
restart recovery of pending settings, complete phone coverage, and desktop
layout/performance acceptance remain separate evidence requirements. They are
not marked complete by the fixture tests above.

## Ordinary settings-save schema regression

Desktop rechecking exposed a strict IPC mismatch: normalized settings always
include `agents.kun.ade.projectDefaults`, while ordinary `settings:set` had no
allow-list entry for it. The IPC schema now reuses the shared bounded project
map schema. Empty and non-empty project defaults survive full SettingsView
snapshots, without permitting secrets, executable paths, or unknown fields.

A targeted four-file group passed 33 tests, including the formerly failing
registered IPC workspace test. The additional pipeline test preserves allowed
fields through IPC parsing, app settings normalization, runtime serialization,
RuntimeConfigApplyRequest, and persisted KunConfig parsing. Negative cases prove
all strict boundaries reject secret and unknown project fields. The runtime
hot-apply and persisted-config schemas already supported the field; no duplicate
runtime schema patch was necessary. Desktop verification requires rebuilding the
Electron main process after this change.

## Final configuration evidence audit

This audit reads the implemented paths and existing tests; it starts no new
production edits or test/build processes. Checkbox changes are limited to the
configuration work below. A checkbox records its stated implementation and
regression coverage, not successful execution on every real Agent account.

| Items marked complete | Implementation and existing regression evidence |
| --- | --- |
| 6.1-6.2 | Shared project/task allow-lists define set/unset, origins, resolved snapshots and atomic routes. `ade-project-defaults-service.test.ts`, `thread-service-execution-config.test.ts`, and the strict IPC pipeline test reject incomplete routes, duplicate operations, credentials and executable paths. |
| 6.3 | Shared types, settings normalization/merge, ordinary strict IPC, the dedicated CAS endpoints, runtime serialization and Kun configuration parsing preserve the field. The ordinary-save regression and runtime harness-config tests cover both full settings and hot/persisted runtime configuration. |
| 6.4 | Object revision hashes are distinct from runtime application generations; task responses separately expose current/pending snapshots. `settings-section-ade.test.ts` checks older/newer application receipts and `thread-service-execution-config.test.ts` checks pending admission. |
| 6.5 | `app-settings-kun-harness.test.ts` covers missing fields and legacy defaults; execution-config tests cover restore-inheritance; manager-runtime tests cover permission clamps; runtime harness-config tests cover deterministic repeated serialization. |
| 9.3 | Collaboration/project drafts remain outside autosave and survive internal category changes. `settings-draft-navigation.test.ts`, `use-settings-draft-controllers.test.ts`, and the collaboration panel tests cover keep editing, discard, successful/failed save, and restored drafts. |
| 11.1-11.2 | The choose/connect/finish state is recoverable; custom/imported IDs remain stable. Wizard, custom-form save-gate, terminal, import/export round-trip, and persistence tests cover the supported entry types and duplicate saves/IDs. |
| 11.4-11.5 | Wizard/custom-form fingerprints invalidate edited connections; timestamps mark old checks stale. Secret values bind to opaque refs and are excluded from restored drafts. Cancellation propagates through the client, while runtime timeout/abort tests cover cleanup. Handshake and opt-in trial have separate results; explicit unready saves and terminal-only saves cannot claim a completed structured run. |
| 12.1-12.2 | Real filesystem/git tests cover distinct same-name directories, symlinks and linked-worktree source mapping. The project service uses object CAS and the panel uses explicit local overrides and unset-to-inherit behavior. |
| 12.3-12.4 | The local project defaults card has a separate save boundary from `.kun/project.json`. Existing repository editing, current-digest approval, MCP/Skills summaries and shared-path controls remain wired to their existing services. Project-runtime/service tests cover approval invalidation, unapproved declarations and generated MCP isolation; project-default panel tests show local restore does not write repository config. |
| 26.1 | Compatibility fixtures cover legacy permission defaults, absent task snapshots, old verdicts with unknown revision, old review history and stable imported custom-Agent IDs. Existing values are retained and migration/restore operations are repeatable. These are fixture guarantees, not a rollback drill. |

The following related items remain unchecked for specific reasons:

- 7.5-7.6: CAS, independent-object writes, stale receipts, non-secret fields and
  draft exit behavior have coverage. The dedicated collaboration-save path does
  not yet have a complete protected-setting denial plus saved-but-offline/failed
  application retry acceptance sequence; ordinary settings tests alone do not
  establish that whole sequence.
- 11.3 and 11.6: setup prefill and resumed wizard state exist, and native-login
  fixture checks omit unrelated gateways. Real install/login failure, return to
  the same step, and per-Agent recovery still require the recorded B04 runs.
- 12.5: identity/CAS cases are covered, but this item also combines missing-path
  recovery, concurrent repository-file changes and unapproved command execution.
  No single completed acceptance sequence covers that full set here.
- 13.6: current/pending and legacy request fixtures exist; full process restart
  with pending settings and older-runtime capability fallback needs explicit
  integration evidence.
- 14.4: task targeting, draft retention and race guards have unit coverage. The
  full preview-worker plus narrow-screen/keyboard acceptance is left to the
  desktop verification record.
- 26.2: Code/ADE aliases, old list-query semantics and unsupported task-settings
  fallback have targeted tests. The complete old-client/old-runtime operation
  matrix is still incomplete, so this broad item remains open.
- 26.3-26.5: no same-version rollback/backup drill was performed by this subtask.
  Legacy surface cleanup, final specification reconciliation and blocker-free
  delivery require the parent implementation's final evidence review.

## Manager tool catalog after settings application

The compiled desktop flow exposed another production boundary: configuration
hot apply rebuilt the main CapabilityRegistry without the manager provider
registered at startup. Valid Code collaboration threads consequently lost every
`worker_*` and `harness_list` schema after a settings save.

Startup now retains that provider for subsequent registry construction. Its
callbacks continue reading live policy and the existing ManagerRuntime. Task
workspace observers are still attached exactly once at startup.

`runtime-collaboration-tools.integration.test.ts` passed through actual Runtime
composition, Code thread creation, turn admission, AgentLoop, and a local HTTP
model fixture. Starting globally disabled and enabling by hot apply restores
manager schemas; a second save keeps one copy; disabling removes new-work tools
while retaining existing controls; an ordinary Code thread never receives
manager tools. The fixture only captures schemas and returns text, so no paid
model requests or fixture-side tool advertisement were involved. Compiled
application smoke must rebuild Kun to consume this fix.

## Detached worker event fencing

The compiled worker flow exposed stale parent-turn fences in background activity
projection. The detached child inherited the parent's AsyncLocal context;
`projectChildActivity` then mirrored child progress into the parent session using
the settled parent turn's fence. Its fire-and-forget subscription did not handle
projection rejection, producing the observed unhandledRejection entries.

Detached execution and host-owned completion delivery now leave the parent
mutation scope. Detached child mirror events are thread-scoped and retain the
immutable association in `child.parentTurnId`, allowing the parent to finish or
start a later turn without pretending that the old turn still owns writes.
Workspace-event fan-out and scheduled worker notices also start from host scope.
Projection failures have an explicit diagnostic handler. Manager fence checks,
ordinary tool writes, and the generic RuntimeEventRecorder are unchanged.

The real Manager HTTP regression covers both a completed parent with no active
turn and a concurrently active next parent turn. The worker continues, its own
session event persists, and progress/completion projections persist on the
parent. A mutation from the original expired tool fence still receives HTTP 409
and writes no event. Combined detach, stop, notice and existing memory-fence
coverage passed 5 files / 21 tests. The system-Node Manager fixture used its
supported JSONL fallback when the installed Electron SQLite binary had a
module-ABI mismatch; no native dependencies were rebuilt. Compiled desktop smoke
remains the final validation with the application's normal storage backend.
