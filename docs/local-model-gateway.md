# Local model gateway

Kun can give several coding clients a stable model endpoint while keeping
upstream API credentials inside Kun. This is a model transport within the
existing Kun runtime, not a second agent runtime.

The [provider configuration contract](provider-configuration-and-gateway.md)
describes groups, v2 persistence, account scheduling, client scopes and budgets.

## Choose the right connection

- **API-key model provider:** configure an official HTTP API connection, such as
  DeepSeek, Kimi/Moonshot or GLM/Zhipu. A ready credential makes it eligible for
  gateway export; it does not prove a successful paid inference.
- **Native Agent account:** Codex/ChatGPT, Claude Code and Cursor accounts keep
  their existing engine-specific login, enablement and readiness controls.
  Native subscription access is not a general-purpose model API entitlement.
- **Unsupported integration:** WorkBuddy is not an implemented Kun gateway
  provider. Cursor's SDK delegates complete turns; it is not a raw model
  upstream. The retired Gemini CLI execution harness stays retired; Gemini
  model-provider support is a separate capability.

Provider registration, authentication readiness, a cached quota observation,
protocol readiness and a successful model request are distinct facts. Adding a
key or detecting a CLI must not mark all of them successful. Inference tests may
incur provider charges and run only when explicitly started.

## Stable aliases across clients

Create a routed model with a stable public alias, for example `coding`.
Select an account and model together in the route target menu. Explicitly
configure any fallback targets you want to receive requests: fallback can send
the same conversation to another provider.

Point Codex, Claude Code, OpenCode or Pi at that alias once. Subsequent account
or model changes take effect for new requests without rewriting each client.
An in-flight request retains its admitted route constraints. Switching native
engines still uses the existing next-turn selection and session handoff; it
does not make native sessions portable.

The gateway supports:

- `GET /v1/models` (add `?format=text` for one id per line)
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`
- `POST /v1/messages/count_tokens` (estimate, not provider billing)
- `POST /v1beta/models/{model}:generateContent`, `:streamGenerateContent`,
  `:countTokens` and `GET /v1beta/models` (Google Gemini)
- `GET /v1/kun/route?session=<id>[&after=<seq>&wait=<s>]` (route trace)
- `GET /v1/kun/limit` (the calling key's own limits, usage and reset times)
- `GET /api/hello` (unauthenticated identity probe)

All public routes except `/api/hello` require a gateway key. Use an
`Authorization: Bearer ...` header; Anthropic clients may use `x-api-key` and
Gemini clients `x-goog-api-key` (or `?key=` on `/v1beta` paths only).

### What agents learn from the gateway

Each `/v1/models` entry carries `display_name`, `reasoning`,
`supported_reasoning_levels`, `default_reasoning_level`, `context_window`,
`max_output_tokens`, `modalities` and `native_endpoints` when the registry
knows them. Unknown facts are omitted, never guessed. A routed alias publishes
only what every member guarantees: the intersection of reasoning levels and
modalities and the smallest window and output limit; it lists no native
endpoints because any member may need translation.

The production runtime writes `~/.kun/gateway.json` (mode 0600) with its base
URLs, process id, instance id and the `/api/hello` address. The file contains
no credential; `/api/hello` reports the same instance id, so a client can
confirm the file names the live process. A switch on the Gateway page turns the
file off. When two Kun instances run, the first keeps the file and the second
leaves it alone; once the first quits, the second republishes it within a few
seconds. A file left by a crashed process is replaced, since liveness needs
both the process and its hello endpoint to answer.

A client may prefix its key with `kun-<app>.` (for example
`kun-claude-code.kun_local_…`). The prefix only names the app for usage
attribution; the remainder is the credential that is verified. Without it,
an `x-kun-agent` header or the first User-Agent product names the agent.

Usage and route traces are grouped by the agent's own session when it sends
one: `x-kun-gateway-session-id`, Codex's `session-id` header (older builds
`session_id`) or `client_metadata.session_id`, Claude Code's
`x-claude-code-session-id` (also inside `metadata.user_id`), Kimi Code's
`prompt_cache_key: session_<id>`, and OpenCode's `promptCacheKey: ses_<id>`,
which OpenCode sends because Kun's provider entry sets `setCacheKey`. Droid
and Gemini CLI send no session id, so their usage groups by key only.

Send a session id and `GET /v1/kun/route?session=<id>` reports
the asked model, the rule that decided the turn, every member tried with its
failure reason, and the served model, before the first token. `after` and
`wait` long-poll for the next change. Sessions are hashed with the caller's
identity, so a client can read only its own.
The listener remains loopback-only. Never publish the runtime admin token as a
client key, put credentials in URLs, or expose this listener through a tunnel
without a separately reviewed deployment/authentication design.

## Review and apply client setup

The Connection Center shows installation/readiness independently from provider
authentication and past inference evidence. Expand standalone setup to create a
separate key, inspect a secret-free configuration diff, and choose a folder with
the native desktop picker. Codex, OpenCode and Pi profiles live only under that
folder's `.kun-gateway` directory. Apply requires the reviewed, expiring plan;
outside edits and pre-existing unowned files block replacement. The previous
generated configuration is backed up. Restore returns to that version, or
removes a first-time generated profile. Kun does not launch the client.

Claude Code uses a session-only environment and keeps its thinking settings.
The Anthropic ingress accepts `thinking` (enabled, adaptive or disabled) and
`output_config.effort`, maps them to the route's reasoning effort, and streams
reasoning back as `thinking` blocks with a gateway-issued signature. Replayed
thinking text returns to the model as reasoning history; client-held signatures
are never forwarded. Provider continuation state (Anthropic signed thinking
blocks, Gemini thought signatures, Responses reasoning items) is kept
server-side for six hours, scoped to the caller, and restored onto the
replayed tool call with the same id. Native Claude account behavior is
unchanged.

### Agents page and `kun agents`

Settings → Local API → Agents lists Claude Code, Codex, OpenCode, Pi, Gemini
CLI, Crush, Droid, Goose, Continue, Aider, Kimi Code and Zed when installed.
Connecting first shows the change to each file as a diff with the key masked
(`kun agents connect … --dry-run` prints the same). Connect writes only the keys Kun owns in
the agent's own config (comments, order and formatting elsewhere stay as
they were), issues the agent its own attributed gateway key, and keeps a
`.kun-backup` copy beside each file while connected. Switching models widens
that key to the new model. Disconnect restores the file byte for byte when
nobody edited it since Kun's last write, key by key otherwise, revokes the
key and removes the backup. Profiles save every connected agent's model and
reasoning under a name and switch them together; "Sync model lists" rewrites
agents that keep their own list. The same operations are available as
`kun agents connect|disconnect|sync|save|use`.

A file Kun cannot parse, or one using a shape it will not rewrite (YAML
anchors, several YAML documents, a non-object root), is reported by name and
left untouched; the page explains these in the app language. Claude Code
ignores a `settings.json` with comments or trailing commas, so the page flags
such a file even before connecting, and Kun refuses to connect until it is
plain JSON. Gemini CLI reads Kun's settings only in folders the user trusted.

Zed keeps provider keys in the system keychain, which Kun does not write. Kun
adds itself to Zed's `settings.json` as an OpenAI-compatible provider named
Kun and sets it as the agent's default model; the key goes to the clipboard
once (from the main process, never to the page or a file), to be pasted in
Zed's agent settings, or set as `KUN_API_KEY`. Switching models keeps that
key. "Copy a new key" or `kun agents key zed` rotates it, since Kun keeps no
copy.

The file guards detect ordinary conflicts and existing links, but are not a
sandbox against a malicious same-user process racing directory replacement.
Choose a trusted local folder. OpenCode may merge other global/project settings;
inspect its resolved configuration before use. Native client home files are
never imported or overwritten by Apply. Keep `.kun-gateway` out of version
control: after launch, a client may write its own session history or account
state there even though the generated configuration contains no secret.

## Export policy and routing

The same policy applies to direct provider IDs, aliases, fallback targets and
managed harness grants: configured HTTP API-key providers with ready
credentials, or explicitly anonymous HTTP providers with `not-required`
credentials, and declared models can be exported. Native SDK, subscription and
OAuth connections are not exportable, with two explicit exceptions: an
extension provider whose extension declared `gatewayExport` and for which the
user picked the account to use, and a ChatGPT subscription connection the user
turned on under the experimental sharing switch after reading its risk
notice. Neither widens an existing client's policy. A scoped harness grant
narrows the eligible route set; it cannot expand it.

Route pools can also carry turn rules (agent, prompt size, images, requested
effort, local hours, message text or a classifier intent) that put one member
first for the turn and hold that decision until the user's next turn; a
per-member pinned reasoning effort; a manual pick strategy; demotion of a
member whose known window the request fills to 95%; and members that name
another alias, flattened at load with cycle and depth (3) checks. Account
groups gain a `pace` strategy. Conversation affinity is persisted in
`model-routing/affinity.json`, so a restart keeps prompt-cache locality.

Gateway middleware (model mapping, a system prompt scoped by agent or model,
`<think>` tag handling, and user scripts exporting `onModel`, `onSystemPrompt`
or `onText`) runs in order on every protocol. Admission checks the model a
mapping serves. The Gateway page shows the script folder, opens it, and can
write a commented `example-middleware.js`. Scripts load only from the runtime's `gateway-middleware`
folder, run in a `node:vm` context without string code generation, are
limited to 250 ms per call (50 ms per text delta), and fail open; `node:vm` is
not a security boundary, so scripts are trusted user code like hooks.

An alias may contain old or currently unavailable targets in durable settings.
Those targets remain visible for repair, but are not authorized upstreams.
Provider/model identities are checked at request admission and every fallback
attempt, rather than only when constructing the menu. A provider/credential hot edit
invalidates pending dispatch proofs; a request fails safely instead of adopting
new access during a fallback or asynchronous credential lookup.

Retries have a bounded total gateway attempt budget and a shared deadline.
Provider cooldowns honor bounded Retry-After hints. Fallback stops as soon as
content, reasoning or tool output starts. The gateway does not execute client
tools, and never replays a partially emitted tool call on another provider.
This boundary is not an exactly-once guarantee for a client's own tool runtime.

## Protocol fidelity

OpenAI Responses input preserves instructions and function-call/result history.
Function namespace groups use collision-checked internal aliases while the
caller retains separate namespace/name identities in results and replayed
history. Custom/grammar tools, nested groups and deferred discovery are rejected
until they can be represented faithfully.
Responses streams expose item/content lifecycles and protocol-shaped usage;
Chat streams use stable tool indexes and completion reasons. Unsupported
semantic controls and content are rejected with an actionable request error
instead of silently disappearing during translation. OpenAI-format upstream
requests explicitly use `store:false`; Kun offers no stored-response retrieval.
This is not a promise about a provider's independent retention/training policy.
Gateway responses use `Cache-Control: no-store`. Anthropic cache hints are
optional performance hints and are not a portable cache/billing guarantee.

Endpoint compatibility does not imply universal model capability. Tool,
image, structured-output, reasoning and provider-managed content support still
depend on the target model and the implemented translation. Unknown mandatory
semantics must fail closed. Golden fixtures and isolated client smoke tests
are compatibility evidence, not proof that every future client version works.

## Credentials, sessions and accounting

Use a separate revocable gateway key for each external client. New keys are
limited to the chosen alias and currently approved accounts; future alias
changes cannot expand that account allowlist. Legacy keys retain an explicit
unrestricted migration marker until the user narrows their policy. Client keys are
stored encrypted by Kun and are distinct from upstream provider secrets and
short-lived managed harness grants. Creating or revoking a client connection
is an explicit management action. Revocation rejects new requests immediately;
already admitted streams retain their current request lease until completion,
cancellation or deadline. Revoking the legacy shared key does not revoke
independent client keys; the UI presents those actions separately. Each client
key can also be rotated, and revoke can explicitly cancel its active requests.
Optional token budgets use Manager-persisted per-attempt reservations. Hard
mode requires a declared account input ceiling plus bounded maximum output.
Sent requests without usage retain a pending reservation across restart.

A key reads its own window, usage, remaining allowance and reset times from
`GET /v1/kun/limit` (`kun gateway keys limit <client-id>`; the Gateway page
shows the same per key). Refusals say when to retry: a rate-limited key gets
`retry-after`, `retry-after-ms` (both honored by the OpenAI and Anthropic
SDKs) and `x-kun-limit-reset` from its token bucket, a busy concurrency slot
suggests one second, and a budget or cost refusal names the end of its window
in the headers and the message. Upstream failures pass on the provider's own
retry time. A streaming request refused by its budget gets a plain 429 rather
than a stream that ends in an error: local refusals happen before any upstream
call, so the gateway waits up to 1.5 s for the first chunk before committing.

The Gateway page's Recent routes list the last 100 requests from every caller
(asked model, served model, why, each fallback and its failure). Finished
entries survive a restart; `kun gateway routes` prints them and
`kun gateway route <alias>` shows which members an alias would try now.

Client/session correlation is an attribution aid, not authorization to an
existing Kun conversation. External callers cannot use a session header to
claim another thread's identity. Request metadata must not include raw keys,
conversation bodies or arbitrary local paths. Gateway calls bypass the native
model-debug content sink even if full capture is enabled elsewhere. Untrusted
upstream diagnostic text and codes are replaced by safe status-based errors so
a provider error cannot echo its credential to an external client.

Measured token usage and actual selected provider/model belong to the existing
usage ledger. Catalog/reference costs are estimates; they are not an upstream
invoice. Subscription quota observations remain a separate native-account
surface. Missing upstream usage must remain missing, not guessed as a bill.

## Plugin boundary

Model-provider adapters, gateway protocol translators and whole-turn Agent
harnesses are separate capabilities. Existing extension source, version and
permission review continues to apply. A plugin is executable code, not an OS
sandbox. Installing a community provider does not establish vendor permission
to export a consumer subscription or share its credentials.

This implementation references Magpie's control-plane ideas but does not copy
its subscription bridges or promise their service compatibility. Any future
code reuse must retain the source license notices and independently review
provider access terms.

## Offline client validation

Two gates use real client binaries. The agent wiring smoke
(`npm run smoke:agent-wiring`) uses the agents installed on the machine and
checks the Agents page path: native config takeover, text and tool turns
through the gateway, routing, middleware, session attribution and exact
restore. The pinned conformance workflow below checks protocol behavior
against fixed versions.

The conformance workflow pins Codex CLI 0.160.0, Claude Code 2.1.220 from the
locked Claude Agent SDK 0.3.220, OpenCode 1.1.47 and Pi 0.73.1. Reports include the checked-out commit, dirty
state, exact client versions and bounded request-shape summaries. Unexpected
versions fail by default; a local developer may explicitly allow and report a
version mismatch. CI does not use that override.

These tests call the real gateway with a deterministic fake upstream and
isolated client homes. They do not sign into accounts or consume model quota.
The client smoke verifies text streams, a real read-only tool followed by a
second model call, and client cancellation reaching the upstream AbortSignal.
Claude main/small aliases are exercised separately. OpenCode explicitly reuses
main for its small model; Codex and Pi do not expose an independent small-model
protocol in this integration. All generated files come from production templates.
Pi's `apiKey` references a bare environment variable name, rather than shell
interpolation. Namespace/tool history, parallel calls and streaming events also
have dedicated protocol regression fixtures. See the
[release validation record](provider-gateway-release-validation.md).
