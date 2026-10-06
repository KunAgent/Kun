# Provider configuration and the local gateway

This document describes the implemented local provider platform. The broader
proposal remains in `openspec/changes/refactor-provider-config-and-unified-gateway`;
unchecked proposal tasks are not release claims.

## Independent responsibilities

Provider connections own upstream model authentication, endpoint selection,
catalog discovery and request scheduling. Agent harnesses own executable
installation, native login, process/session lifecycle and tools. A provider
catalog refresh never installs or probes an Agent executable.

Kun's existing Runtime executes model requests. The public gateway decodes
OpenAI Chat Completions, OpenAI Responses or Anthropic Messages into that same
path. Serial tool selection is preserved through all three wire protocols; an upstream
that emits a second call for a serial request is rejected. The calling Agent executes returned tool calls. The gateway does not
start a second agent loop.

Built-in presets now live in `packages/provider-catalog/src/definitions/*.json`.
The package validates schema versions, IDs, URLs, protocols and supported
fields, and retains its existing exports. Templates describe settings; they
contain neither executable hooks nor account secrets. Updating a descriptor
does not overwrite an existing user's connection or frozen template snapshot.

## Configure accounts

Use Settings > Providers to add presets or custom compatible HTTP connections.
Each added account has its own connection ID and credential. The provider
configuration panel adds group defaults, field inheritance, enablement,
discovery and account admission settings. Pausing a connection keeps its
configuration and removes it from new executable selections.

An explicit endpoint binding separates `base` URL mode from `full` URL mode.
Full endpoints must declare their wire protocol; their URL receives no appended
inference path. Proxy choices are inherited, direct or an explicit proxy URL.
Proxy URLs containing credentials are rejected by the new configuration schema.

An explicitly anonymous HTTP connection uses `authType: none` and
`credentialStatus: not-required`. An absent or unreadable API key is never
converted into anonymous access. Anonymous upstreams still require an
authenticated gateway client. Subscription/OAuth and whole-agent adapters keep
their existing export restrictions.

Extra request header values live in the protected Credential Store. Ordinary
snapshots show only header names. Authentication and protected-header profiles
declare exact destination hosts and purposes independently of the wire format.
Inference, discovery, OAuth and quota cannot borrow one another's permission;
public metadata never receives account secrets. Inference and discovery reject
redirects so headers cannot follow an unexpected destination.

## Discover models

- Auto discovery reads the account's provider catalog. Empty successful results
  remain empty. Stored selected models are not added to discovery evidence.
- Manual discovery uses explicitly configured model IDs.
- Custom discovery supports a GET URL, JSON Pointer paths and cursor pagination.
  Cross-origin credential forwarding requires an explicit approved host.
  Requests are limited to 15 seconds, 20 pages, 2 MB and 2,000 models.
- `models.dev` enriches discovered or already configured models. It does not
  prove that additional catalog models are available to this account.

Catalog caches bind to account/credential/endpoint/protocol/header identity.
Their filenames use SHA-256 instead of lossy replacement of punctuation. A
credential or endpoint change makes old observations historical. Failed refreshes
preserve historical results and mark them stale. Selected IDs absent from a
successful catalog remain visible for repair; refreshing does not delete them.

ChatGPT subscription discovery uses its own credential and a separately cached
compatibility version from public `@openai/codex` package metadata. That request
contains no provider credentials and has no dependency on an installed Codex
Agent. Successful version checks last 24 hours; failure retries after five
minutes while retaining the last working or bundled minimum version. Actual
account availability still comes from the authenticated provider catalog.

Readable credentials, HTTP reachability, catalog success, protocol validation
and successful inference are separate evidence stages bound to current account
identity. Manual models do not become network evidence. Capability and price
fields retain source, observation time and known/unknown state; default context
or tool assumptions are excluded from guarantees. The catalog panel shows these
facts without sending a paid inference request.

## Configuration transactions and exchange

`model-connections.v2.json` is the Registry authority for the new fields.
AppSettings and the legacy snapshot API remain compatibility projections.
Runtime snapshots are consumers, not independent copies to edit by hand.

The admin API provides:

| Operation | Path |
| --- | --- |
| Paged, searchable snapshot | `GET /v1/provider-config` |
| Review named operations | `POST /v1/provider-config/transactions/preview` |
| Commit a reviewed revision | `POST /v1/provider-config/transactions/commit` |
| Secret-free exchange document | `POST /v1/provider-config/export` |
| Additive import preview | `POST /v1/provider-config/import/preview` |
| Commit reviewed slot bindings | `POST /v1/provider-config/import/commit` |
| Explicit encrypted backup | `POST /v1/provider-config/backup` |
| Reviewed backup restore | `POST /v1/provider-config/backup/preview` |
| Downgrade compatibility preview/export | `POST /v1/provider-config/recovery/preview`, `/recovery/export` |
| Route eligibility without inference | `POST /v1/provider-config/routes/preview` |

These routes require the Runtime admin token. Gateway keys cannot manage
providers. Previews expire after ten minutes, bind to an input digest and
revision, and have bounded memory. Commits use Manager CAS and durable
idempotency receipts. Saved revision and active Runtime revision are reported
separately; an activation failure is not reported as an unsaved transaction.

Imports remap conflicting account/group/template/route IDs and aliases, rewrite
dependent references, and reject incomplete reference closures. Existing
objects and client permissions are not overwritten by an import. Secret slots
can bind protected credential/header inputs before the reviewed atomic import;
unbound slots remain drafts. Slots cannot point at arbitrary local credentials.
An ordinary exported configuration is not a credential backup.

An explicit portable backup uses a separate password-derived key and
authenticated encryption. Ordinary exports, previews and snapshots contain no
secret values. Restore decrypts into reviewed import slots, remaps identities
and rechecks the expected revision before publication. Wrong passwords,
tampering and unsupported versions fail before publication.

## Shared execution and routing

Native model calls, public gateway calls and Main text utilities reuse Runtime
model clients. Inline completion, scheduled-task classification, prompt
optimization and paper translation send provider/model identities through the
strict admin text-request API. They do not forward projected credentials or
endpoint URLs. Electron Main fails closed if the Runtime executor is not ready.

Account concurrency and bounded queues apply across callers sharing that
account. Waiting callers rotate fairly. Cancellation and queue timeout release
their leases. Existing accounts without an explicit admission override retain
their previous capacity behavior. Media execution is not covered by this text
scheduler.

Routes retain existing priority, rotation, weight, latency, usage and adaptive
strategies. An optional turn/session affinity has TTL and LRU limits and is
scoped to the caller. Native routed and public gateway requests share a maximum
of four physical upstream attempts and the gateway's 120-second default
deadline. Queues and retries consume that deadline. After semantic text,
reasoning or tool output starts, automatic target switching stops.

Route preview reports next strategy order without advancing its cursor,
eligibility, excluded targets and conservative shared capabilities without
dispatch. Guaranteed mode publishes known capability/context minima; filter
mode admits only candidates capable of the particular request. Unknown facts
never become guarantees or trigger silent capability downgrade. Actual routing
rechecks configuration, client permissions and health. Manual recovery allows
one bounded half-open probe. Real inference tests remain a separate action.

## Client keys and token budgets

New client keys are scoped to the selected public alias and its approved
connections. Adding another connection to the alias does not expand an existing
key. Policies also constrain protocol, expiry, concurrency, request rate,
body/output size and timeout. Legacy keys retain an explicit unrestricted
migration mode until narrowed. Rotation preserves client attribution; revoke
can optionally cancel active requests. One-time keys reach the desktop clipboard
through protected Main IPC, rather than ordinary renderer state.

Optional hard token budgets reserve before every physical attempt, including
retries. They require an explicitly declared account input-token ceiling and an
enforced output limit; unknown bounds and media inputs fail admission. The
declared ceiling must cover the upstream model's input window. This is an
admission bound, not a guarantee about a provider's anomalous billing.

Measured usage settles reservations. Sent attempts without usage stay pending,
including across restarts; known unsent attempts refund their reservation.
Soft mode records reservations and displays over-budget state without denying
dispatch. Periods use the configured IANA time zone; period/time-zone edits
apply after the open window ends, while limit changes apply immediately.
Measured tokens, reserved tokens and catalog cost estimates remain separate.
No hard monetary-budget guarantee is offered.
Optional cost alerts compare separately identified estimates with a configured
USD/CNY threshold; they are advisory and never fabricate measured token usage.

The ledger includes physical attempt identity and known usage from abandoned
fallback targets, rather than counting only the final target. Response token
counts remain separate from accounting totals so context-window planning does
not mistake retries for a larger prompt. Native harness
gateway accounting retains its existing source attribution. Automatic approval
review waits for the first concrete gateway target and keeps its account
scheduling and configuration fence; it cannot fall through to a default account. Reissuing a harness
token for a different target set creates a separate grant; it cannot widen an
old live grant.

## Migration and rollout limits

Startup retains v1 as a recovery source and publishes v2 only after protecting
legacy header values. A secret-free migration journal makes interrupted header
protection retryable. The existing v1 recovery file may still contain its old
header values; migration does not create another plaintext copy of them.
After v2 publication, Manager rejects writes/deletes to the legacy Registry.
Do not delete v2 or copy v1 over it to downgrade: new accounts and permissions
would be lost. A reviewed downgrade projection uses current v2 identities, not
the stale recovery file. Every current field must be expressible in v1; groups,
inheritance, disabled accounts and new policies otherwise block downgrade.
Future canonical schema versions fail closed.

Deletion previews list Registry defaults/routes/client scopes and external
ADE/role/plan references. Registry references require explicit handling in the
same transaction; external references block deletion until their owner removes
them. Commit rechecks references created after preview. Pausing preserves
identity and references while stopping new admission.

Standalone local applications, Codex, Claude Code, OpenCode and Pi can consume
public aliases through the Connection Center's existing isolated configuration
workflow. Managed ADE harnesses support a structured main alias and, where the engine
exposes it, a small-model alias. Approved accounts belong to the Agent profile;
resumed turns retain their original model/account target ceiling. Native login,
direct provider selection and gateway aliases remain distinct modes. Model-only
grants never imply Kun-tool permissions. Agent installation and native-account management stay separate.

LAN/public listeners, Gemini-native ingress, media export, nested routing and
extension export remain separately proposed P5 work. External reference owners
are not silently rewritten by a provider transaction. The listener remains
loopback-only. See [release validation](provider-gateway-release-validation.md)
for fixed-client, scale, boundary and packaged acceptance evidence.
