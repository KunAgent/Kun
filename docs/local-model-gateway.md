# Local model gateway

Kun can give several coding clients a stable model endpoint while keeping
upstream API credentials inside Kun. This is a model transport within the
existing Kun runtime, not a second agent runtime.

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

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`
- `POST /v1/messages/count_tokens` (estimate, not provider billing)

All public routes require a gateway key, including `/models`. Use an
`Authorization: Bearer ...` header; Anthropic clients may use `x-api-key`.
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

Claude Code uses a session-only environment. Its compatibility profile disables
thinking and automatic effort (`MAX_THINKING_TOKENS=0` and
`CLAUDE_CODE_EFFORT_LEVEL=unset`); signed/adaptive reasoning is unsupported.
Managed Claude gateway turns similarly require reasoning off. Native Claude
account behavior is unchanged.

The file guards detect ordinary conflicts and existing links, but are not a
sandbox against a malicious same-user process racing directory replacement.
Choose a trusted local folder. OpenCode may merge other global/project settings;
inspect its resolved configuration before use. Native client home files are
never imported or overwritten by Apply.

## Export policy and routing

The same policy applies to direct provider IDs, aliases, fallback targets and
managed harness grants: only configured HTTP API-key providers with ready
credentials and declared models can be exported. Native SDK, subscription and
OAuth connections are not exportable. A scoped harness grant narrows the
eligible route set; it cannot expand it.

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

Use a separate revocable gateway key for each external client. Client keys are
stored encrypted by Kun and are distinct from upstream provider secrets and
short-lived managed harness grants. Creating or revoking a client connection
is an explicit management action. Revocation rejects new requests immediately;
already admitted streams retain their current request lease until completion,
cancellation or deadline. Revoking the legacy shared key does not revoke
independent client keys; the UI presents those actions separately.

Client/session correlation is an attribution aid, not authorization to an
existing Kun conversation. External callers cannot use a session header to
claim another thread's identity. Request metadata must not include raw keys,
conversation bodies or arbitrary local paths.

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
