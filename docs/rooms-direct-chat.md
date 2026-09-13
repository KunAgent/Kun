# Chat-first Rooms

This supersedes the default-team onboarding flow documented in
`rooms-init-im.md`. The previous team, conversations, tasks, avatars and memory
remain readable; entering Rooms now idempotently adds only one general Kun
Agent and its private conversation. Professional templates are opt-in.

The UX reference is the public Grok Bot demo at <https://x.ai/bot> and its
creation/chat documentation at <https://docs.x.ai/grok-bot/bots>. The public demo
shows a recipient chooser and immediate creation of a chat-ready Agent. It does
not establish how Grok Bot's cloud implementation works. Per-Agent main and
lightweight model controls follow the local Cumora Agent editor's inheritance
and independent-selection workflow.

## Conversation workflow

- The v3 entry marker records first positioning independently from the old
  five-person setup. Existing drafts and explicit navigation take precedence.
- New creates a recipient chooser: existing Agent, group selection, quick new
  Agent, or a professional template. Identity and private room commit together.
- Private headers show identity and the effective main model. Profile, memory,
  run history, files and context reset are in menus. Advanced policy controls
  stay collapsed; basic profile edits do not overwrite model or policy fields.
- Enter sends; Shift+Enter inserts a line break. IME composition and mention
  acceptance take precedence. Cmd/Ctrl+Enter remains supported.
- The composer starts at one line, grows to six and then scrolls. Attachments,
  references, emoji, group mentions/polls and project selection use the plus menu.
- Ordinary responses have no implicit quote or reply count. Explicit reply
  branches retain their host-proven root. Run inspection is a hover/focus action.
- A busy private chat accepts queued messages and shows a brief status. Tool
  details are expandable; approvals and user-input requests use existing gates.

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
activity/control/context and scoped files. Main IPC allowlists and shared types
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
