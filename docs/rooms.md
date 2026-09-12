# Rooms V1

Rooms is a personal collaboration workspace alongside Code and Work. A room
contains persistent members, explicitly authorized local Git repositories,
public discussion, and separately tracked execution tasks.

## Using Rooms

Create a room, choose its repositories and members, and send a message.
Coordinator, Developer and Reviewer presets are supplied; configured Kun
profiles can also be selected. Members inherit the current API model unless
their model/provider configuration overrides it.

New rooms default to autonomous collaboration. The coordinator invites members
or assigns work within the user's explicit goal. Directed mode addresses only
the selected members, or the default member when there is no mention. Messages
can explicitly select discussion or execution, while automatic intent detection
is the default. Discussion does not authorize code changes.

Use the structured member, repository and task selectors to route a request.
Reply to a task to supplement it or select a reviewer. Missing or ambiguous
targets require clarification. Attachments preserve their Runtime attachment
identities and local file paths through the existing attachment bridge.

Tasks keep their member/model/tool configuration and project-agreement snapshot.
Changing room settings affects subsequent work. Fixed agreements come only from
the user's explicit message-pin action. Each autonomous request is bounded to
three discussion rounds. At most two room execution tasks run simultaneously,
with one active task per member, subject to the Runtime's global capacity.

## Delivery and control

Each execution task uses its own Git worktree, created from the repository's
checked-out local branch and committed HEAD. Uncommitted source changes are
excluded and preserved. Source branch changes, unfinished Git operations,
invalid paths and failed isolation block execution.

The task view exposes actual Runtime state, its working directory, delivery
Diff, command verification evidence, and review results. Member progress updates
reuse one durable message identity. Tool and command details stay in the native
execution record, opened through "Open in Code"; pending approvals and structured
questions use that record's existing controls.

Developer output is pinned to a commit before review. Review runs read-only
against that exact version. Automatic repair is off by default; when authorized
in member settings it is limited to two rounds. A new revision requires a new
review. Same-repository sequential dependencies import pinned predecessor
deliveries into the isolated task worktree; divergent branches require manual
integration. Cross-repository dependencies carry the fixed delivery context.

Accepting a delivery and applying it are separate operations. Apply requires
an explicit click, a clean target on the recorded local branch, and a successful
fast-forward merge. Its durable attempt binds the exact delivery and target;
an uncertain response can be reconciled without applying a different revision.
Conflicts and interrupted attempts preserve all worktrees, branches and pins.

Cancellation reports "stopping" until Runtime confirms termination. Retrying
requires the old execution to have stopped. Room execution history cannot be
rewritten, rebound, forked, deleted or independently resumed through generic
thread controls. Use room actions to preserve its task lifecycle.

## Persistence and recovery

The Service Manager owns `rooms/rooms.sqlite`. Runtime accesses it through
the Manager data plane; there is no second canonical copy in the renderer.
SQLite transactions bind request deduplication, revision checks, document
updates and replayable events. A fenced Manager resource lease elects one
coordinator across Runtime flavors. Thread admission uses durable identities
and the existing queued-turn dispatcher.

Room/task/message history is paginated. Published message edits preserve their
sequence so streaming tokens do not reorder the room list. The public event API
supports SSE replay and bounded JSON polling. Closing a room view or switching
to Code/Work does not stop scheduling. Closing to tray preserves execution;
real GUI quit stops its owned Runtime. Restart reconciles existing execution
identities; uncertain side effects require recovery rather than blind replay.

Archiving stops new room messages but preserves existing tasks and deliveries.
Members with unfinished work can be disabled rather than removed. V1 does not
automatically delete task directories or offer permanent room deletion.

## Model and release boundaries

V1 uses Kun's native model loop and its enforced tool policy. Subscription SDK
execution engines are rejected for room turns because they cannot yet consume
the same frozen room capability ceiling. Select a native API model for those
members. This does not change SDK support in Code or Work.

V1 does not include multiple human participants, cloud execution, device sync,
continuous self-directed goals, or general cross-repository Graph orchestration.
Performance figures in the original PRD remain targets, not measured guarantees.

## Verification

Coverage includes real SQLite and Manager HTTP transactions, restart/idempotency,
100 rooms with 100,000 messages and 2,000 task records, actual Runtime queue and
AgentLoop execution, local tool policy enforcement, real Git isolation,
immutable reviews, explicit apply, cancellation and application recovery.
Renderer tests cover routing, stale responses, pagination, retry identity,
attachments and task controls. Desktop and narrow layouts are checked in a
browser fixture; that fixture does not represent live model output.

Validation commands:

```bash
npm run typecheck
npm run build
npm run check:file-lines
cd kun
./node_modules/.bin/vitest run src/rooms src/manager/remote-room-store.test.ts \
  src/server/routes/rooms.test.ts src/loop/room-turn-policy.test.ts \
  src/loop/agent-loop-room-policy.test.ts src/services/thread-service.rooms.test.ts
```

Local verification is on macOS with Node 25.2.1. Windows/Linux packaged-app
execution and real-provider end-to-end smoke remain release validation work;
passing fixture tests must not be described as that evidence.
