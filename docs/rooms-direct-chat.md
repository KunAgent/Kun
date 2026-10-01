# Chat-first Rooms

This supersedes the default-team onboarding flow documented in
`rooms-init-im.md`. The previous team, conversations, tasks, avatars and memory
remain readable. Desktop Code Conversations idempotently adds one general Kun
Agent and its private conversation. Rooms retains the former Bots IM interface
and lists private Agent conversations alongside groups; Code Conversations is
an additional private-chat entry. Both entries open the same room and history.
The phone keeps its existing chat entry. Professional templates are opt-in. See
[Code conversations and Rooms](./code-agent-chats-and-rooms.md).

The UX reference is the public Grok Bot demo at <https://x.ai/bot> and its
creation/chat documentation at <https://docs.x.ai/grok-bot/bots>. The public demo
shows a recipient chooser and immediate creation of a chat-ready Agent. It does
not establish how Grok Bot's cloud implementation works. Per-Agent main and
lightweight model controls follow the local Cumora Agent editor's inheritance
and independent-selection workflow.

## Public response cadence

Fresh user requests in a private Agent Room publish a visible response before
business tools run. `send_im_message.phase` distinguishes `start`, `progress`
and `final`; an omitted phase remains a legacy final reply. The message and
Room run receipt commit together. A question, approval or app connection card
is a visible wait state. A start or progress bubble cannot settle a user task
without a later final result; an app-connection continuation requires a final
result without another mechanical start notice. Reminders and internal wakes
can remain silent when there is no user-facing change.

The next model step requests a progress message after 30 seconds or six
completed work tools since the last visible message, with a ten-second minimum
gap. One long-running tool does not start a parallel model call; the activity
row shows its safe category and locally computed elapsed time. The run records
first response latency, and the selected renderer keeps a bounded in-memory
commit-to-render sample for validation. Raw arguments, output and internal
reasoning remain in the run inspector.

The first-step tool filter is reinforced at dispatch: unadvertised work calls
receive a persisted "not executed" result. Publication failures get at most
two recovery steps before a visible failure. Existing conversations apply the
new rule to their next user request; historical messages need no migration.

## Conversation workflow

- The v3 entry marker records first positioning independently from the old
  five-person setup. Existing drafts and explicit navigation take precedence.
- New creates a recipient chooser: existing Agent, group selection, a
  chat-defined Agent, a filled-in profile, or a professional template.
  Rooms offers all of these through its IM sidebar. Code Conversations uses
  the private recipient picker. Creating or opening a private Agent in Rooms
  keeps the Rooms mode and conversation list visible.
  Identity and private room commit together. Chat definition starts a
  pending interview (`setup.status = pending`) with structured
  `user_input` cards and `commit_agent_setup`. Filling the profile, using
  a template, copying an Agent, or opening the default 小 Kun Agent skips
  the interview. Saving name/title/instructions during an interview, or
  choosing Skip, marks setup skipped and cancels the in-flight turn.
- Private headers show identity and the effective main model. Profile, memory,
  run history, files and context reset are in menus. Advanced policy controls
  stay collapsed; basic profile edits do not overwrite model or policy fields.
- Code and Rooms privately address the same Agent room, with one message
  history and draft. Editing its draft from either entry carries through to
  the other. Project tasks and other rooms retain their own drafts.
- Opening a private file updates the shared right panel without changing the
  recipient or moving a Rooms conversation to Code. Explicit task links retain
  their existing Code navigation behavior.
- Enter sends; Shift+Enter inserts a line break. IME composition and mention
  acceptance take precedence. Cmd/Ctrl+Enter remains supported.
- The composer starts at one line, grows to six and then scrolls. Attachments,
  references, emoji, group mentions/polls and project selection use the plus menu.
- Ordinary responses have no implicit quote or reply count. Explicit reply
  branches retain their host-proven root. Run inspection is a hover/focus action.
- A busy private chat merges new plain-text messages into the running reply and
  marks them as merged instead of queueing separate turns. Tool
  details are expandable. Approvals stay in the progress strip. Pending
  `user_input` requests render as Grok-style choice cards in the private
  timeline; with a card open, composer send is the current question's Other
  answer instead of a new direct turn. Interview prompts stay in private
  turn input, never the stable system prefix.

## Runtime and persistence

New private messages use `direct-v1`, the normal Kun Thread/TurnQueue and native
AgentLoop. They do not require a coordination result or `send_room_message`.
An Agent's owned directory is `agents/workspaces/<agentId>` in the current data
space. Users can explicitly connect a folder without requiring a Git repository.
The Agent's capability and directory limits still apply to discovery and execution.

Compatible requests reuse a persistent thread. Its identity includes the Agent,
private room, workspace, provider/account, instructions, preset/policy and context
reset epoch. A model change within the same account preserves the thread;
provider/account, project or policy changes rebuild the internal session while
preserving public history. The old queue entry keeps its accepted model binding.

Before admission, the host persists the input snapshot, run identity and stable
client request ID. An uncertain admission is reconciled against that exact turn;
it never allocates a replacement because a timeout elapsed. Publication and
`originRunId` commit together. Stream projections and failed drafts cannot feed
collaborators or memory. Cancelling invalidates publication and retains the
original execution identity. Viewing a run uses existing turn-filtered pagination.

When a plain user message arrives while the private turn is still running, the
host records a durable steer intent (`request.steer` with an idempotent
operation id and target turn/run) and admits it through the shared steering
queue. The merged request keeps its own run record, which links to the response
it joined through `mergedIntoRunId`, and settles exactly with that target.
Continuations, reminders, handoff returns, setup interviews, attachments and
task-designated messages keep their own queued turns, as does any message whose
model binding differs. A target that finishes without the steering receipt falls
back to the normal admission path under a fresh attempt identity; cancelling a
merged message stops the response it merged into.

Generated top-level files get scoped content cards. The file browser is bounded
to 100 top-level regular files. Owned Agent files remain available after connecting
a project; disconnected external workspace references fail closed rather than
resolving to a similarly named file in the current workspace. Symbolic path escapes
use the existing repository file reader's canonical-root checks.

Group scheduling, 32/8 budgets, approvals, review and delivery remain intact.
Existing private task requests with an explicit task or external execution owner
retain the previous task protocol. Collaboration tools bind their source to the
current private turn's exact run record; peer handoffs remain scoped and budgeted.

## Models and compatibility

Each Agent has `modelRef` and optional `fastModelRef`, including provider, model
and account. Main inheritance resolves through the preset and Kun default.
Lightweight inheritance is Agent override, global small model, then main. Triage
and memory records preserve the actual lightweight model and usage. The model
query reports concrete inheritance, availability, group override and the last
successful call for the same binding; opening it performs no model request.

Native API connections, including supported subscription HTTP adapters, use the
normal Kun model path. Delegated SDK/CLI connections currently cannot enforce all
Agent tool/directory limits and are visibly unavailable in this selector. They
are rejected before a private model call; this change does not weaken those
limits to make a connection selectable. Existing global provider configuration is
unchanged. Old per-group model overrides can explicitly return to Agent inheritance.

The new HTTP paths are chat-entry, quick-create, per-Agent models, private
activity/control/context, scoped files, and `POST /v1/agents/:agentId/setup`
to skip an in-flight interview. Main IPC allowlists and shared types
are updated. Storage and ownership remain in the single Kun Runtime and Manager.

## Validation

- 422 runtime tests across 65 suites cover Agents, Rooms, queue admission,
  run queries, models, scoped handoffs, memory, cancellation and lost receipts.
- 385 GUI/shared/IPC tests passed in the broader selection. Six failures
  were reproduced unchanged on local `develop`: five non-English settings
  completeness checks and one existing project-board route allowlist assertion.
- Typecheck, `build:kun`, complete build, changed-file ESLint and the 700-line
  gate passed. Full lint passed with zero errors and 30 warnings.
- `node scripts/smoke-development-direct-chat.cjs --evidence <directory>` starts
  a real isolated Electron + Manager + queue and a model-only offline fixture.
  It creates and sends exclusively through the UI. Seven requests exercise file
  work, an actual switched-model response, cancellation while the model is active,
  drafts/reload, two model selections, themes and a narrow window.
- `--workbench-only` checks the mixed Rooms IM list, existing private history
  shared with Code, private and group creation from Rooms Add, recipient-safe
  file previews and draft recovery across surfaces. It uses one offline greeting
  to establish public history in its disposable profile.
- Real acceptance used the existing configured `deepseek-v4-pro` connection with
  four user requests: greeting, file creation, continuous modification and project
  work. All passed, including actual file contents and approval UI. There were
  eleven upstream calls (eight main, three background), at most three per request,
  within the authorized eight-request / ten-calls-per-request limit.
- Native file selection and approval confirmation use narrowly scoped dialog
  fixtures; renderer/preload/main and protected approval IPC are real. Native OS
  clicking itself is not claimed as automated coverage.

The acceptance scripts remove their isolated processes and data. Screenshots and
reports are kept outside the feature worktree, under the main repository's ignored
`dist/rooms-direct-acceptance` directory. No credentials are written to the report.
