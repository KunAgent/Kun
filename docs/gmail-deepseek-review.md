# Gmail processing through DeepSeek API

Review preparation updated: 2026-10-13. This document records the implemented
disclosure and evidence basis; it does not state that Google has approved the
Gmail scopes or that the real integration demonstration has passed.

## Exact recipient and permission

- The cloud recipient is DeepSeek's direct API, `https://api.deepseek.com`.
- Only an exact host-reviewed API account/credential and supported fixed HTTP
  route may receive Google data. No automatic route/account failover is allowed.
- The Gmail card identifies the recipient and requires a default-off permission
  for each private conversation. A local-model grant cannot become cloud consent.
- The displayed consent uses an opaque host stamp. Grant requests compare the
  recipient and stamp with the actual route before accepting permission. The
  renderer cannot create a provider review or set its account evidence.
- Data sent for the feature includes requested mail headers, addresses, snippets,
  plain-text bodies, current conversation context, summaries and reply drafts.
  Gmail OAuth credentials are never placed in model requests.

## Official API terms and the account review

[DeepSeek Open Platform Terms](https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-terms-of-service.html)
were updated on 2026-04-22 and took effect on 2026-04-29. They cover API developers
and their end-user applications, incorporate the general terms/privacy policy, and
state that the Open Platform and chat service use a unified account (section 2.1).

[DeepSeek general terms](https://cdn.deepseek.com/policies/zh-CN/deepseek-terms-of-use.html)
include API services in section 1.1. Section 4.3 allows de-identified input/output
use for model training and provides the opt-out through the data-improvement
setting. This is an account setting, not a request body parameter.

[DeepSeek privacy policy](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html)
was updated on 2026-02-10 and applies to API services unless a separate policy
states otherwise. Its user controls describe the data-management training setting.

The user explicitly confirmed disabling that setting for the same API account on
2026-10-13. Combined with the unified-account terms, this supports a review based
on contractual applicability and trusted user confirmation. We have not
independently verified an API-specific toggle or a provider-side audit. Do not
describe this as automatic API verification, a written provider guarantee, or a
Google review approval. Keep the exact credential-bound review, its source and
date in the trusted host record; key/account changes invalidate it.

## Retention and location

The [English privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
describes processing/storage in China and retention according to purpose and legal
requirements. No fixed API-log retention period was verified in these sources.

[Automatic context caching](https://api-docs.deepseek.com/guides/kv_cache/)
is enabled by default and uses disk storage. Unused caches are normally cleared
after hours to days; this is not a hard retention maximum. The
[cache announcement](https://api-docs.deepseek.com/news/news0802/)
describes user isolation and no other cache use.

The [Responses API guide](https://api-docs.deepseek.com/guides/responses_api/)
describes stateless response handling and `store:false`. It does not disable KV
caching or establish zero retention. The
[Chat Completion API reference](https://api-docs.deepseek.com/api/create-chat-completion/)
does not document a training opt-out request parameter. Do not treat either request
format as a substitute for the account review.

## Local and remote app records

OAuth and Gmail API calls run in the local Kun runtime; local OAuth credentials
are encrypted. App-managed conversation and operational records can contain
mail-derived content and use the verified encrypted data volume. This is OS-volume
protection, not a claim that every chat file has separate application encryption.
Gmail model requests are excluded from optional HTTP model-debug capture.

User-enabled paired-device viewing can expose canonical mail-bearing chat/SSE
through the user's authenticated selected connection or tunnel and its transport
service. Gmail OAuth and model credentials are never sent to remote clients. IM
bridges cannot receive Gmail conversations. A local inference option does not
mean every mail-derived byte stays on the desktop.

## Release evidence still required

- Check the exact current API credential against the trusted account review.
- Verify a new DeepSeek conversation starts with unchecked cloud consent, and
  existing local permission cannot authorize it.
- Verify endpoint/account change, unsupported failover, stale consent, old mail
  history replay and delegated SDK routes fail before model dispatch.
- Record real Google consent, Gmail search/read, exact-message human-approved
  send, and disconnect/revoke behavior using the same product route.
- Publish the matching privacy disclosure through the approved privacy-only
  overlay, then submit the real video and required review information.

[Google Workspace User Data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
prohibits general AI training with Google data and limits permitted onward use.
Disclosure and consent do not waive those restrictions. Restricted Gmail scopes,
cloud processing and optional remote viewing must be accurately declared; do not
claim a CASA/security-assessment exemption or completed Google approval.
