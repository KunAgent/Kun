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
API model. The members tab can change the per-room override immediately.
The settings view shows profile capabilities and supports additional
tool, MCP and Skill restrictions. These restrictions can only narrow the host's
capability ceiling. Existing tasks retain their frozen member, model, profile,
repository and agreement snapshots. Members can be copied or disabled; removal
must not strand an unfinished execution or its reviewer. The profile management
shortcut opens the existing Agent settings surface.

New rooms default to **Peer discussion** (`peer`). Members independently decide
whether they have useful new information and may invite another member. The
existing **Coordinator collaboration** (`autonomous`) mode continues to let the
coordinator select speakers and assign authorized work; **Directed collaboration**
(`directed`) addresses selected members or the default responder. Existing rooms
keep their saved mode. Each message can explicitly choose discussion or execution;
automatic intent classification is the default. Changing mode affects newly
started topics; existing topics retain their frozen collaboration protocol.
See [Peer discussion](./rooms-peer.md) for topic controls and budgets.
Missing or ambiguous goals, members or repository targets require clarification.
Historical messages, model summaries and attachments do not authorize new work.

Requests awaiting clarification can be continued through their original request
card. Additional text, attachments and explicit member/repository choices are
saved as immutable supplemental inputs; the original goal and completed
responses remain available. Retry repeats a failed step, while continuation adds
new user information. Stopping coordination retains a durable stop intent and
does not cancel already assigned development tasks. Missing or unsettled execution
identities must be reconciled before a continuation can run.

The composer supports typed `@` member selection, repository/task references,
ordinary message replies and attachments. Mentions use stable member IDs.
Replies preserve the original message ID, including when the original message
is outside the loaded history. Attachments retain Runtime IDs and local file
paths; posted files show their names and support preview/download. Message
bodies reuse the existing Markdown, code block and link renderer.

Agents can draft structured proposals — pin an agreement, request an execution,
add a member or create an agent — that render as timeline cards. Drafts never
execute anything; only the user can adopt or dismiss a card, and committing
requires a durable result produced through the ordinary user-scoped paths.
See [Room proposals](./rooms-proposals.md).

Room names and message text can be searched locally. Tasks can be filtered by
status, member or repository. Room, message and task lists use pagination and
virtualization; drafts, reply references and scroll positions survive navigation.
Unread state is persisted after the user actually views the latest messages,
rather than being cleared merely because a room was selected.

## Collaboration context and bounds

Peer discussion allows up to 32 response activations per user-started or
explicitly continued topic, up to 8 per member, and up to 128 participation
checks. Retry and stale-context regeneration count toward those bounds. Only
complete messages, structured invitations and relevant task changes wake peers;
there is no periodic search for new work. Legacy coordinator discussion remains
limited to three rounds per request. At most two room execution tasks run
concurrently across rooms, also honoring each room's `maxConcurrentTasks` and
one active execution per member. Discussion has a separate channel, at most two
activations per room and one per member, subject to Kun's global turn capacity.
Review, integration and unknown execution states participate in the relevant admission/ownership checks; leaving the
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

Enabled project agreements are never silently dropped to fit this budget.
Original versions are frozen into an immutable source bundle. Oversized rules
are automatically compressed in bounded batches using the coordinator model,
with bounded merge and format-repair attempts. The cache binds source versions,
content, model, budget and compression policy. Every compression result must
account for its exact input sources; failure retains the originals and leaves a
visible retryable request error. Compression preserves reference material, not
a proof of semantic equivalence: original rules remain authoritative.

The request and task views show compression state and expose paginated originals.
The scoped read_room_rules tool can inspect only the current execution's frozen
bundle; it is available in coordination, discussion, development, review and
integration. Explicit rule adoption updates the task bundle and recomputes its
compressed guide without changing earlier snapshots.

A discussion referencing delivered code mounts a read-only checkout of the
fixed delivery SHA. A discussion about an unfinished task can inspect its
current worktree with enforced read-only tools and is told that files may change
while execution continues. A reserved worktree that has not been created is not
silently replaced with the source checkout. Discussion file tools may also read
any local path the user names, including when the room has no attached
repository; this does not authorize writes, shell commands, or a new execution
repository. Discussion never amends or steers a task unless the current user
explicitly requests execution.

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
Progress is maintained by an incremental SQLite projection when task facts
change. Overview reads use that projection instead of rescanning all child
execution records. A bounded task preview links to a paginated full task list;
legacy projection backfill exposes an initialization state.

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

Verification logs have a room/task-scoped viewer and download action. New logs
use the existing Manager ArtifactStore with delivery ownership retained across
worktree cleanup. The retained text is capped at 8 MiB per check and explicitly
marks truncation or unavailable archives; command exit evidence is separate.
Native full-output paths are validated against their actual execution storage,
and callers cannot provide arbitrary file paths. Old records use available
execution evidence or explicitly report missing output. Diffs load by file and
byte range, with file search and virtualization.

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
addon. The database schema is version 4 and retains WAL mode, FULL synchronization
and immediate transactions. Upgrade preserves existing room messages, thread
identities, delivery SHAs and pins, and seeds existing agreements' immutable
version history. Version 3 adds paginated review lookup, request activity indexes,
rebuildable outcome projections and a persistent event namespace without
rewriting old messages or execution identities. Local SQLite search indexes are backfilled in bounded batches;
opening the room does not require a complete historical replay. Version 4 adds an
indexed peer topic/member lookup and durable peer documents without replaying
old history as new inbox events. The logical room document's
`schemaVersion` remains 1.

The desktop subscribes to a global room SSE stream from the workbench level.
Room/task updates, unread state and attention counts therefore continue across
Code/Work navigation. Running and attention counts include integrations and
group attention by original request while preserving task-level reasons.
Persisted event cursors support replay; bounded polling
is the fallback when the stream is unavailable. Streaming edits retain their
message identity and sequence instead of moving the room on every token.
Request clarification/failure/recovery and task/integration attention use the
existing desktop notification preferences. Counts deduplicate the original
request while cards expose the individual reasons. A persisted notification
queue is separate from view refresh: failed detail reads or notification sends
retry with backoff even if no later event arrives. Pending entries and delivery
keys survive renderer reload, are namespaced by room storage, and are dismissed
when resolved, already viewed or disabled by notification preferences. Opening
a notification returns to its room.

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
search, individual message lookup, durable read cursors, paginated peer topics
and revision-checked discussion stop, request outcomes and
retry/continue/stop/reconcile, task controls/recovery, delivery history/compare,
scoped original agreements and verification logs, agreement versions and
adoption, integration prepare/open/validate/resolve/cancel/apply, cleanup
preview/execution and SSE events. Generic approval and user-input APIs are reused.
These APIs remain behind the shared desktop IPC allowlist and Runtime auth.
Requests, agreements, versions, deliveries, reviews and integrations use cursor
paging (50 rows by default, at most 200). Review filtering happens before paging.
The desktop retains loaded pages and selections, refreshes relevant entities,
coalesces concurrent reads and does not continuously refresh collapsed evidence
views. Modern overview consumers omit large diff bodies.

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

Peer discussion verification is tracked separately in [rooms-peer.md](./rooms-peer.md).
The updated offline Electron checks passed, including exact structured peer
publication and topic controls. Its real-model comparison is tracked separately;
the historical native-model results below do not establish acceptance of the
new peer protocol.

The following records describe prior verified execution, not a blanket release claim:

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

The latest hardening pass additionally verified:

- The extended macOS Electron flow passed automatic agreement compression,
  original-version browsing, continuation of the same request, durable
  coordination cancellation, and recovery from an injected transient detail-read
  failure. It also retained the existing development, approval/input, integration,
  verification, application and cleanup checks, and exercised per-file diff loading
  and native export of the actual verification output. The report and 23 screenshots
  are in ignored `dist/rooms-hardening-desktop-4/`.
- A real DeepSeek V4 Pro run completed automatic compression, a successful
  read_room_rules lookup, clarification and continuation on the original request.
  Nine upstream calls returned HTTP 200; the frozen bundle and compression cache
  were reused, no development tasks were created, and the source checkout and
  selected provider registry were unchanged. The isolated harness waits for
  coordinator ownership and maintains the production Manager heartbeat.
  Its report is in ignored `dist/rooms-native-hardening-3/`.
- The production rule-tool storage binding is covered by a full managed Runtime
  regression. This caught the distinction between the raw store and the
  lifecycle-fenced store used by the tool registry. Verification output rehydration
  also has a regression so compact metadata cannot silently produce an empty log.
- A 30-minute storage benchmark covered 100 rooms, 100,000 historical messages,
  2,000 historical tasks, 1,205 pending tasks and a large integration diff. It
  consumed all 8,587 emitted events with no backlog. The measured tick p95 was
  7.92 ms; RSS was about 383 MiB after fixture setup and 217 MiB at the final
  sample. Activity payloads omitted the large diff. These are local storage
  measurements, not desktop frame-rate or cross-platform guarantees. Evidence
  is in ignored `dist/rooms-hardening-benchmark/`.

Useful validation commands from the repository root:

```bash
npm run typecheck
npm run build
npm run check:file-lines
node scripts/smoke-development-rooms.cjs --timeout-ms 180000 \
  --evidence dist/rooms-hardening-desktop
node scripts/benchmark-rooms.mjs --duration-ms 1800000
# Explicitly uses the selected native Chat Completions API profile:
node scripts/smoke-native-rooms.mjs --run
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
