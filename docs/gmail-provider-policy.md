# Gmail model provider gate

This gate was researched and implemented on 2026-10-12. The initial public release
permits only a verified Kun-managed local Ollama process with cloud disabled.
Cloud processing is disabled by default; its endpoint checks remain for future
operator-controlled review and do not declare any account approved for public use.

The local client receives an opaque proof containing the owned numeric loopback
origin, exact `qwen3:4b` model, direct physical fetch, and current-process assertion.
Only the managed launcher constructs this proof. The reserved display profile does
not supply its transport, URL, or credentials. Every physical request checks the
proof and exact loopback endpoint. Ordinary localhost profiles stay unapproved.

## Existing boundaries

`ModelProviderProfileV1` supports provider identity, endpoint overrides, API/SDK
transport kinds, models, and proxy selection. Neither this profile nor the provider
catalog declares verified Google-data processing, training, retention, or onward
transfer controls. A preset label cannot supply that assurance.

The current profile's selected route is `stepfun-token-plan / step-5-preview`.
A narrow settings projection found no direct `api.openai.com` or loopback-model
profile. Credentials are managed separately, so absent inline keys are not evidence
that existing profiles are unusable. No credentials were read or printed.

The runtime supports endpoint overrides, per-model protocol changes, nested route
pools, account failover, subscriptions, and extension/gateway clients. Checking only
the selected provider ID at the time a checkbox is clicked leaves those alternate
destinations outside the check.

## Provider evidence

OpenAI's [API data controls](https://developers.openai.com/api/docs/guides/your-data)
describe default non-training and retention behavior. Its
[business security page](https://openai.com/business-data/)
describes encryption. However,
[organization/project data sharing](https://help.openai.com/en/articles/10306912-sharing-feedback-evaluation-and-fine-tuning-data-and-api-inputs-and-outputs-with-openai)
can opt API inputs and outputs into model improvement. An exact OpenAI hostname
therefore verifies the recipient, but does not verify the account's sharing state.
Do not describe `store:false` as a training opt-out or zero-retention guarantee.

Gemini's [API terms](https://ai.google.dev/gemini-api/terms)
distinguish unpaid and paid services. The paid status depends on the API key's
project billing, which cannot be inferred from the endpoint hostname. The first
Gmail release should reject unverified Gemini accounts, including subscription and
CLI routes, rather than assuming paid terms from a model name.

Ollama's [privacy policy](https://www.ollama.com/privacy)
states that cloud prompts are processed transiently and are not used for training.
This is a candidate for a reviewed direct cloud API route. It still requires
disclosure of the recipient and processing arrangement, transport review, and an
actual configured account. It is not currently configured in the narrow profile
projection. Its [cloud documentation](https://docs.ollama.com/cloud)
also shows cloud models running through the localhost API; localhost alone does
not establish local-only processing.

No sufficiently specific official non-training commitment for the current StepFun
Token Plan route was verified in this investigation. Reject that route for Gmail
model processing until its relevant service terms and account controls are reviewed.

## Smallest enforceable initial scope

Support one fixed reviewed HTTP API provider/account for each Gmail conversation.
Reject automatic model selection, route pools, provider/account failover, opaque
subscription SDKs, remote agent harnesses, extension model providers, and gateway
routes in Gmail-bearing conversations. This avoids approving a primary destination
while silently transmitting mail to a different fallback.

A trusted host review record should bind provider/account identity, exact HTTPS
origin and supported request paths/protocols, credential generation, evidence of the
account's data-sharing terms/settings, review date, and expiration. The human
conversation checkbox is a separate permission; it must not create a provider
review record. An arbitrary GUI field claiming `noTraining:true` is insufficient.

For OpenAI, the record needs verified disabled data sharing for the exact account
and project, or an account type/contract where that sharing cannot be enabled.
Public documentation alone must not be presented as proof that a particular
customer's project has disabled optional data sharing. If that state cannot be
checked, keep the route disabled instead of inventing an account attestation.

Before granting model sharing or fetching mail, capture the actual concrete model
client, endpoint resolution, account generation, and approved policy record. Reject
any context where the runtime cannot enforce them. Binding consent to this exact
selection also makes a provider change require another disclosure and consent.

Carry a host-owned Google-data classification through tool results, persisted
conversation provenance, generated summaries, new turns, compaction, titles,
subagents, and model-history replay. Marking only the original Gmail tool result
does not protect a later summary after the provider changes.

Immediately before every physical model request, check the classification against
the same policy record and concrete client. Include HTTP retries, credential
refreshes, protocol fallbacks, auto classifiers, compaction/title calls, and child
tasks. Unsupported or changed destinations must fail before transmitting a body.
Reject redirects; the current compatible HTTP client already uses `redirect:error`.
Set `store:false` for supported API requests, with accurate retention disclosure.

The existing `paperReadOnlyDispatchGuard` structure provides useful wiring:
`RoutePoolModelClient` refuses automatic failover, `MultiProviderModelClient`
captures object identity/generation, and the concrete HTTP client has a pre-dispatch
hook. Gmail needs its own reviewed endpoint/account guard; the paper guard alone
does not validate vendor data handling.

The Gmail status view can expose `modelSharingAvailable`, a safe reason, and the
approved provider name. A connection-only flow remains possible when this is false,
but the model-sharing checkbox and agent read/send tools must fail closed.

Tests should prove that changing an endpoint/account after consent, introducing a
fallback, reusing old history with an unapproved provider, or requesting compaction
cannot send Google data. A provider-guard failure should never enter ordinary
failover. The real review demonstration must use the same approved route and
account configuration that the product will enforce.
