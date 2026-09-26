# Room approvals and private-chat permissions

Rooms use a compact approval card showing the pending action, tool and working
directory. The visual reference is Cumora's neutral confirmation-card layout in
`src/desktop/AgentsView.tsx`; Cumora does not provide the same tool-approval
protocol. Command and file content remain readable, with long content scrolling
inside the card. English, Chinese, light, dark and narrow layouts are supported.

## Confirmation boundary

Selecting Review and allow or Deny opens a separate sandboxed Electron window.
Main obtains the pending action from the Runtime and displays that canonical
content. The protected window has an isolated session, a minimal preload, no
workbench bridge and no extension scripts. It renders action text as data and
accepts only a trusted button activation from its own main frame.

The existing short-lived approval token binds the precise action and decision.
Closing or cancelling the confirmation leaves the pending approval unchanged.
An expired action closes the confirmation. Main rejects renderer requests that
impersonate automatic policy approval; automatic review remains Runtime-owned.
Code retains its existing manual confirmation presentation.

## Composer permission modes

The private-chat composer reuses Code's permission picker and preset definitions:

| Mode | Approval policy | Sandbox | Reviewer |
| --- | --- | --- | --- |
| Ask for approval | on-request | workspace-write | user |
| Approve for me | on-request | workspace-write | agent |
| Full access | auto | danger-full-access | user |

The selection belongs to this private conversation. It does not change global
Code settings or other conversations. Unconfigured conversations start with Ask
for approval. A mode change requires protected confirmation, persists through
the Manager store with revision checks and idempotent request identity, and
publishes the existing room update event. Reading settings never calls a model.

Accepted and queued requests keep their frozen policy. New requests use the
new selection; a retry is a new attempt using the current confirmed policy and
Agent limits while retaining the original workspace. Unknown executions must
still be reconciled before retrying. Changing modes rebuilds incompatible
internal threads with bounded reference history from the current context epoch.

Full access removes the private conversation's default workspace-only tool
scope. Agent read-only presets, directory ceilings and explicit tool, MCP and
skill restrictions remain enforced. An Agent with a directory ceiling cannot
select full access. Limits changed after selection are rechecked at admission.
Group discussions stay read-only for writes and commands, but file-read tools
may inspect local paths the user names. Legacy task execution remains confined
to the authorized task checkout. The private-chat picker is hidden for legacy
task drafts.

The read endpoint is `GET /v1/rooms/:roomId/direct/permissions`. Mutation uses a
dedicated protected preload method and a signed, one-use consent binding room,
request, expected revision and mode. Generic renderer HTTP requests cannot PUT
this setting. The protected main process reads canonical approval details from
`GET /v1/approvals/:id`, which is not on the generic renderer path allowlist.

## Validation

- Runtime regression: 67 suites / 437 tests passed; the final admission and retry
  changes also passed 14 targeted tests. Coverage includes frozen permissions,
  current Agent ceilings, external writes and invalid/replayed consent tokens.
- Renderer/main regression: 28 suites / 152 tests passed; final protected-dialog
  and sender checks passed 32 targeted tests.
- Typecheck, full build (including build:kun), lint and the 700-line gate pass.
  Lint reports 30 pre-existing warnings and no errors.
- Real Electron, Manager and Kun queue acceptance uses an isolated data space
  and offline model fixture. It exercises creation and sending through the UI,
  manual allow and deny, rejected synthetic activation and forged policy allow,
  automatic review, actual full-access external file creation, cancelled changes,
  unchanged global settings, persistence, Chinese dark mode and a 760px window.
  No real model calls are required for this permission/UI acceptance.

Run the desktop scenario after building:

```bash
KUN_APPROVAL_EVIDENCE=/absolute/evidence/path \
  node scripts/smoke-development-direct-chat.cjs --approvals \
  --evidence /absolute/evidence/path
```

Keep evidence outside disposable worktrees. The scenario saves a JSON result and
screenshots of inline approvals, protected confirmations and composer modes.
