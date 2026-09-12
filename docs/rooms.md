# Rooms V1

Rooms is a personal collaboration workspace alongside Code and Work. It uses
Kun's existing native AgentLoop and the Renderer -> preload -> Main -> Kun
HTTP/SSE path. The Service Manager remains the only owner of canonical room
data; the renderer does not run a second coordinator or agent engine.

## Room setup and conversation

Create a room and configure its members, default responder and authorized local
Git repositories. Coordinator, Developer and Reviewer presets are supplied;
existing Kun Agent profiles are also available. The first repository selected
in the create dialog is assigned to the initial members. Later repository
permissions remain explicit per-member configuration.

Members can inherit their profile/default model or choose a configured native
API model. The settings view shows profile capabilities and supports additional
tool, MCP and Skill restrictions. These restrictions can only narrow the host's
capability ceiling. Existing tasks retain their frozen member, model, profile,
repository and agreement snapshots. Members can be copied or disabled; removal
must not strand an unfinished execution or its reviewer. The profile management
shortcut opens the existing Agent settings surface.

New rooms default to autonomous collaboration. The coordinator invites members
or assigns work within the current user's explicit goal. Directed mode addresses
selected members, or the default responder when there is no mention. Each
message can explicitly choose discussion or execution; automatic intent
classification is the default. Changing collaboration mode affects new requests.
Missing or ambiguous goals, members or repository targets require clarification.
Historical messages, model summaries and attachments do not authorize new work.

The composer supports typed `@` member selection, repository/task references,
ordinary message replies and attachments. Mentions use stable member IDs.
Replies preserve the original message ID, including when the original message
is outside the loaded history. Attachments retain Runtime IDs and local file
paths; posted files show their names and support preview/download. Message
bodies reuse the existing Markdown, code block and link renderer.

Room names and message text can be searched locally. Tasks can be filtered by
status, member or repository. Room, message and task lists use pagination and
virtualization; drafts, reply references and scroll positions survive navigation.
Unread state is persisted after the user actually views the latest messages,
rather than being cleared merely because a room was selected.

## Collaboration context and bounds

Autonomous discussion is limited to three rounds per request. At most two room
execution tasks run concurrently, with one active task per member, also subject
to Kun's global execution capacity. Review, integration and unknown execution
states participate in the relevant admission/ownership checks; leaving the
page does not free an execution slot.

Coordination, member discussion and task execution share a frozen room context
snapshot containing explicit references, effective project agreements, recent
messages, related historical messages and an incremental summary. Retrieval is
scoped to the same room. Summaries retain a covered-message cursor and are
reference material, never automatically approved project rules.

The supplemental context snapshot is capped at the smaller of 16,000 tokens
and one quarter of the room members' context windows. The implementation
uses serialized UTF-8 bytes as a conservative token upper bound. This bound is
for the room snapshot, not the entire model request: the current user input and
normal Runtime tool history are handled separately. Explicit references take
priority over background history; truncation is recorded.

A discussion referencing delivered code mounts a read-only checkout of the
fixed delivery SHA. A discussion about an unfinished task can inspect its
current worktree with enforced read-only tools and is told that files may change
while execution continues. A reserved worktree that has not been created is not
silently replaced with the source checkout. Discussion never amends or steers a
task unless the current user explicitly requests execution.

The coordinator submits `submit_room_plan`, and reviewers submit
`submit_room_review`; validated JSON remains a compatibility path. Invalid
structured results receive at most two bounded format-repair attempts without
creating partial task assignments. Exhaustion leaves a visible failure and a
step-specific retry. Retrying coordination or review does not rerun completed
development merely to repair output formatting.

The request overview aggregates actual child task state, including running,
needs-attention, partial completion, awaiting acceptance and completed results.
Finishing assignment is not treated as finishing the user's overall request.
Terminal updates produce a deduplicated room summary with per-task results.

## Agreements, task execution and review

Only an explicit user pin creates a project agreement. Agreements have stable
IDs and immutable versions; users can edit, disable, restore and inspect their
history. New tasks use the latest active versions. Existing task snapshots do
not change automatically when a rule is edited.

"Notify active tasks" explicitly adopts a selected agreement version for chosen
tasks. The dedicated adoption endpoint binds the rule version and expected task
revision, persists trusted adoption metadata, and then sends the amendment. When
that amendment is consumed, the effective task agreement snapshot is updated.
Copying an agreement into an ordinary chat message does not impersonate this
adoption record. Retries preserve admission identity and cannot silently adopt
a different version.

Each execution task uses a separate Git worktree from the selected local
branch's committed HEAD. Uncommitted source changes are excluded and preserved.
The task's repository does not follow Code's currently selected project. Wrong
paths, changed repository identity, unfinished Git operations and failed
isolation block the operation rather than falling back to the source directory.

The task panel shows actual Runtime status, working directory, frozen
configuration, progress, verification, delivery and review evidence. Pending
approvals and structured questions can be answered directly in the room.
Approvals use the protected `resolveKunApproval` bridge and native confirmation;
structured answers use the existing Runtime user-input API. Integration
executions expose their own pending gates, so those decisions target the actual
integration thread instead of the original developer/reviewer thread.
"Open in Code" opens the same execution record without duplicating the task.

Developer output is pinned to an immutable commit before review. Review runs
against that exact version in an independent read-only checkout. Delivery
history remains browsable during repairs; versions can be compared, and old
reviews are explicitly marked as not covering the current delivery.

Manual "continue with review fixes" and automatic repair use the same feedback
handoff: review findings, reviewed SHA, user requirements and attachments remain
associated with the correct version. Automatic repair is disabled by default;
when enabled it is limited to two rounds. A new delivery requires a new review
and does not inherit acceptance of an older version. Reviewer-specific user
instructions and attachments reach the review turn.

Same-repository sequential tasks import pinned predecessor deliveries into their
isolated worktree. Divergent dependency branches preserve the work and require
integration rather than overwriting it. Cross-repository dependencies carry the
fixed delivery context, and their results remain independently deliverable.

Verification requires explicitly declared checks through `declare_room_checks`.
The recorder matches declarations to actual tool calls, command results and
background-session completion events. It records the relevant version and
evidence references, handles failed checks followed by reruns, and invalidates
verification when files change afterward. A still-running background command
blocks delivery finalization. An exit status from an arbitrary command, or text
claiming success, is not complete requirement acceptance.

## Acceptance, integration and cleanup

Accepting a delivery and applying code are separate user actions. Direct apply
requires a clean target on the recorded local branch and a fast-forward merge.
The attempt is bound to the exact delivery and target state; an uncertain
response cannot cause a different revision to be applied.

When the target has advanced or direct application is not appropriate, prepare
an isolated integration worktree from the current target HEAD. The original
delivery, commit and review pins remain unchanged. The integration panel shows
the candidate SHA, Diff, conflicts, validation results, review and prior
candidate history.

Conflicts can be handled in Code or by an explicitly requested developer repair.
Human edits must be frozen and revalidated before application. Declared checks
run on the candidate, and any configured reviewer reviews that candidate's
immutable version. A changed candidate or target invalidates the prior apply
preconditions; the user must prepare or validate an updated candidate.
Failed verification or unsatisfied review blocks application. With no recorded
checks, application requires a separate explicit unverified-candidate consent.

Integration apply persists its intent before changing Git. Recovery can detect
that Git already completed the operation even if the database acknowledgement
was lost, including when the target subsequently advanced. Unknown or live
executors are not treated as safely stopped; recovery-required integration
states retain their work and cannot bypass activity checks. Cancellation keeps
its intent until the original turn and background work are confirmed stopped.

Cleanup is an explicit operation with a disk-usage/path preview and a fresh
validation token. Only applied or explicitly abandoned work with confirmed
stopped execution is eligible; cancelling a task alone does not discard its
unaccepted output. Dirty files, active/background execution, unaccepted
integration candidates and dependent references prevent removal. The source
repository is never a deletion target. Cleanup can resume after interruption
and retains immutable delivery history and the Git references needed for it.
There is no automatic directory deletion or permanent room deletion.

## Persistence, events and recovery

The Manager owns `rooms/rooms.sqlite`; Runtime accesses it through the Manager
data plane. SQLite transactions bind request IDs, fingerprints, revision checks,
state changes and replayable events. A fenced Manager resource lease elects one
coordinator across Runtime flavors. Thread/turn admission uses durable identities
and the existing queued-turn dispatcher.

Rooms uses Node's built-in `node:sqlite`, without a separately compiled SQLite
addon. The database schema is version 2 and retains WAL mode, FULL synchronization
and immediate transactions. Upgrade preserves existing room messages, thread
identities, delivery SHAs and pins, and seeds existing agreements' immutable
version history. Local SQLite search indexes are backfilled in bounded batches;
opening the room does not require a complete historical replay. The logical
room document's `schemaVersion` remains 1.

The desktop subscribes to a global room SSE stream from the workbench level.
Room/task updates, unread state and attention counts therefore continue across
Code/Work navigation. Running and attention counts include integrations and
count the same task only once within each category. Persisted event cursors support replay; bounded polling
is the fallback when the stream is unavailable. Streaming edits retain their
message identity and sequence instead of moving the room on every token.
Task and integration attention notifications use existing desktop notification
preferences. Integration gate changes publish room events carrying their parent
task ID; the client reads the actual integration approval/input IDs and execution
identity. Repeated progress events do not repeat an already observed gate alert,
while a new gate receives its own notification. The currently focused room
suppresses notifications already visible there. Opening a notification returns
to its room.

Closing a room panel, switching modes or closing to tray does not stop execution.
A real GUI quit stops that GUI's owned Runtime. Restart reconciles original
thread/turn identity, Manager ownership and actual Git state. The recovery panel
can inspect/reassociate a known execution, cancel it, or retry/abandon after
stopped-execution evidence is available. Ambiguous side effects retain capacity
and require reconciliation rather than blind replay. Application recovery must
be resolved before a conflicting task amendment or cleanup.

Room execution history cannot be rewritten, rebound, forked, deleted or
independently resumed through generic thread controls. Room lifecycle actions
preserve those relationships. Archiving prevents new room messages while
retaining existing work and deliveries; it does not cancel active tasks.

Public room APIs include room/member configuration, paginated messages and
search, individual message lookup, durable read cursors, request outcomes and
retry, task controls/recovery, delivery history/compare, agreement versions and
adoption, integration prepare/open/validate/resolve/cancel/apply, cleanup
preview/execution and SSE events. Generic approval and user-input APIs are reused.
These APIs remain behind the shared desktop IPC allowlist and Runtime auth.

## Model and release boundaries

Rooms uses Kun's native API model loop. Subscription SDK execution engines are
not supported for room turns and are identified in settings/composer before
sending. Select a native API model for affected members. This does not remove
SDK support from Code or Work or introduce another Runtime.

This release does not include multiple human participants, cloud execution,
cross-device sync, continuous self-directed goals, permanent room deletion,
remote PR publication or general cross-repository Graph orchestration.
Scale fixtures exercise paging and bounded state; original PRD performance
figures are not measured latency, memory or throughput guarantees.

## Verification status

The following records describe verified execution, not a blanket release claim:

- Automated coverage includes SQLite/Manager transactions and upgrade, request
  idempotency, context/retrieval bounds, rule adoption, permissions, real
  AgentLoop execution, immutable reviews, cancellation/recovery, Git integration,
  declared/background verification, cleanup, and renderer interactions. Scale
  fixtures cover 100 rooms, 100,000 messages, 2,000 historical tasks and more than
  1,000 pending records. Relevant typechecks, builds and lint checks have passed.
- The updated macOS arm64 Electron smoke passed through the real renderer,
  preload, Main, Manager and Runtime. It exercised background execution across
  modes; developer approval/input inside the room; agreement edit, disable,
  restore and history; search and durable reads; delivery history and reload;
  an advanced target branch; integration-specific input and protected Bash
  approval; a declared command with exit code 0; immutable integration review;
  explicit application; and cleanup retaining source files and delivery history.
  Its endpoint is an offline deterministic model fixture. The report and 18
  screenshots are in ignored `dist/rooms-product-final-smoke/`.
- The first updated Electron run exposed a POST allowlist matching bug and
  duplicate React sibling keys. Both were fixed before the successful rerun.
  Final screenshots were inspected and no page exceptions or duplicate-key
  warnings occurred. The actual narrow viewport was 960 by 780, constrained by
  the application's minimum width, and its overlay passed the hit-test.
- Native consent traversed the real protected IPC/native-dialog path using
  one-shot fixture answers bound to the expected action. Manual operating-system
  dialog clicks were not tested. Unverified-candidate consent is covered by
  targeted UI/Git tests; the successful updated Electron integration used an
  actually executed validation command.
- A native DeepSeek probe completed a real tool write and subsequent code
  discussion in five model calls. This is real-provider evidence for that small
  scenario, not evidence for every collaboration or recovery path.
- A separate native DeepSeek manual-review probe completed in ten model calls:
  `changes_requested` with a finding, explicit manual repair, a new immutable
  delivery, and a passing review bound to the new SHA. The final task awaited
  acceptance, with no automatic rework. The synthetic source checkout and
  original provider registry remained unchanged. Earlier probe stalls were
  traced to missing Manager heartbeats in the embedded test harness; adding
  the production heartbeat mechanism fixed both timed replay and real-provider
  execution without changing product streaming code.
- Windows and Linux application execution/upgrade have not been verified in
  this run. No Windows host was available, and the local Docker daemon was
  unavailable. macOS evidence and fixture tests must not be described as
  all-platform or complete real-model acceptance.

Useful validation commands from the repository root:

```bash
npm run typecheck
npm run build
npm run check:file-lines
node scripts/smoke-development-rooms.cjs --timeout-ms 180000 \
  --evidence dist/rooms-product-completion-smoke
npx vitest run src/renderer/src/components/rooms \
  src/renderer/src/components/chat/__tests__/WorkspaceModeTabs.test.ts
cd kun
./node_modules/.bin/vitest run src/rooms src/manager/remote-room-store.test.ts \
  src/server/routes/rooms.test.ts src/server/rooms-managed-runtime.integration.test.ts \
  src/loop/room-turn-policy.test.ts src/loop/agent-loop-room-policy.test.ts \
  src/services/thread-service.rooms.test.ts
```

Smoke helpers isolate their settings, Git repository, Runtime data, Manager
control directory and processes, and remove temporary execution state afterward.
Reports and screenshots are ignored build evidence rather than committed assets.
