# Agent model selection and management

## Before conversational creation

Rooms **New conversation > Define in chat** first opens a provider/account/model
selection dialog. Discovery performs no write and no model inference. Nothing is
created until the user selects an eligible connection and presses Continue.
Cancel, Back, or a pre-confirmation reload leaves no Agent or conversation.

The runtime requires the explicit binding and rechecks the current configured
provider, credential readiness, account identity, supported Agent scope, and
model catalog before committing. It never selects an alternative on the user's
behalf. Local configuration readiness is not proof that remote authentication,
quota, or inference will succeed; the UI says this explicitly.

Creation has an idempotent request identity. A lost response is reconciled through
a read serialized behind pending room mutations. The browser retains only a
confirmed request's ID, name, and non-secret model binding in session storage;
reopening checks that identity without creating anything automatically. An
unknown result keeps retries bound to the same request and warns before leaving.
No credentials or API keys are stored by the dialog.

## Conversation model versus role defaults

Every private Agent composer shows the exact provider/account/model selected for
that conversation. A successful change writes `Room.privateModelRef` under the
room's expected revision. It does not rewrite the Agent or global defaults,
permissions, workspace, or context epoch. Sending is disabled during the change.
An error restores the authoritative selection and offers a refresh.

Accepted requests keep their existing `privateModel` snapshot, including queued
requests and active replies. The next accepted message uses the conversation
binding. A deliberately retried failed request uses the corrected binding while
the failed attempt remains unchanged. Stale account/model selections are rejected
instead of silently falling back.

**Manage all Agents** is available from the Rooms sidebar, private conversation
header, and empty view. The existing Agent directory shows each role's effective
model, provider/account and local readiness, with search, archived filtering,
pagination and a visible Configure action. Agent details reuse the existing
profile editor and expose Models inline. Model edits save immediately with
saving/saved/error states; profile edits retain their explicit Save operation.
The UI distinguishes role defaults from existing conversation overrides.

## Validation

Focused runtime and React tests cover missing/stale selections, account changes,
unsupported connections, duplicate clicks, request replay/reload reconciliation,
cancellation, concurrent revisions, unchanged active requests, failed-request
retry, role/conversation separation, and model manager navigation.

`node scripts/smoke-development-direct-chat.cjs --agent-models-only --evidence <directory>`
uses the existing disposable Electron/Manager/Runtime fixture and offline model
responses. The native-workspace workflow runs it on macOS and Windows after its
build and Electron setup, and retains screenshots for
creation, the composer, the Agent directory overview, role configuration, and the
primary group-chat button.
It never reads a real account's credentials or sends paid model requests.
