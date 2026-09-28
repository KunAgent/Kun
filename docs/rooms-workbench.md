# Bot and Code / Work hand-offs

A private bot Agent can hand work to the user's Code and Work modes, read what
lives there, and be told what happened. Everything runs through the single Kun
runtime and the Rooms data plane; no second runtime or renderer-side loop is
involved. The design and the implementation notes are in
[bot-workbench-bridge-plan.zh-CN.md](./bot-workbench-bridge-plan.zh-CN.md).

## What the Agent can do

Tools exist only inside a private Agent conversation turn (`roomAgent` and the
`conversation` step). Room, member, Agent and run identity always come from the
running turn and its recorded run, never from model arguments.

| Group | Tools | Effect |
| --- | --- | --- |
| Code, read | `list_code_projects`, `search_code_threads`, `read_code_thread`, `get_code_task` | Reference-only summaries of the user's Code projects and sessions |
| Code, write | `create_code_task`, `message_code_task`, `stop_code_task`, `add_board_card` | Hand a task to Code, refine or stop it, propose a board card |
| Work, read | `list_work_spaces`, `search_work_documents`, `read_work_document` | Plain-text Work documents inside registered workspaces |
| Work, write | `create_work_document`, `propose_work_edit`, `create_work_task` | New document, exact-match edit proposal, or a task for the Work assistant |
| Citation | `send_im_message.references` | Clickable cards for a Code session or Work document the Agent may read |

## Authority

- Each Agent has a policy: Code `off | confirm | auto`, Work `off | read | confirm | auto`, and a
  limit on tasks in flight (1 to 5, default 3). Defaults are `confirm`, `read`, 3. The tool set a
  private thread advertises is frozen from the policy; every call re-checks the live policy.
- `confirm` publishes a card (`presentationKind: workbench_task`) and ends the turn. Nothing runs
  until the user accepts through `POST .../workbench-links/:id/confirm`, which carries the card revision.
- `auto` starts immediately only for a **fresh user request** (`room_run.communicationRequired`).
  Continuations, reminder wakes, handoff returns and task-outcome wakes always fall back to a card.
  A directory the user never used in Code also always needs a card.
- Directory limits (`allowedRepositoryRoots`) apply to Code projects and Work workspaces. A Code task
  never runs with a wider permission mode than the Agent's own private mode.
- Anything the Agent reads back (session excerpts, document text, task results) is marked
  `reference_only`; it cannot authorize new work.

## Lifecycle

A `workbench_link` document (Manager-owned `rooms.sqlite`) tracks each hand-off:

```
awaiting_confirmation -> queued -> running <-> needs_attention -> completed | failed | cancelled
                      \-> dismissed                      recovery_required (uncertain admission)
```

- Routes only record decisions. The room runtime's `tick()` runs a reconciler that creates the
  target thread (deterministic id), prepares an optional isolated worktree, admits the first turn
  under a fixed `clientRequestId`, follows the real turn and records the outcome. Restarting never
  creates a second session; an uncertain admission becomes `recovery_required`.
- Code and Work tasks are ordinary sessions marked with host-written `workbenchOrigin`; the Code
  sidebar shows a bot badge and the header says which Agent started it.
- When a task ends and `report` is `final`, a `workbench_task` continuation wakes the Agent with a
  bounded outcome (final text excerpt, changed files, checks). It is delivered even if the user has
  written newer messages in the meantime. `silent` only updates the card.
- If the user writes in the target session, the link is marked `userTookOver` and the Agent stops adding to it.

## From Code and Work to the bot

- Code: session menu and header can cite the session in the bot's draft, or ask the bot to tell the
  user when a running session finishes (`POST .../workbench-links/watch`, a user action).
- Work: the toolbar cites the open document. Board cards travel as text.
- The desktop shell pushes its Work workspaces and Code projects to `PUT /v1/workbench/directory`;
  Kun keeps the last snapshot on disk.

## Validation

```bash
cd kun && ./node_modules/.bin/vitest run src/workbench-bridge src/server/routes/register-workbench-link-routes.test.ts \
  src/domain/thread-workbench-origin.test.ts src/rooms/room-ax-surfaces.test.ts
npx vitest run src/renderer/src/components/rooms src/main/ipc
```
