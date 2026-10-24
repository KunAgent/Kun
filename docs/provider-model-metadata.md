# Provider model discovery and metadata

Kun separates model discovery, capability observations, user preferences, and
resolved execution capabilities. Model identity is scoped to a connection and
its upstream model ID. A model listed by a public directory is not proof that
an account can call it.

## Sources and preferences

Model profiles carry versioned `metadata` with independent `overrides`,
`overrideEvidence`, and `observations`. Legacy flat fields remain compatible;
the configuration projection retains the user's original values. Runtime and
management snapshots resolve those values and include `metadataResolution`.

- Account model responses are the first source of capability facts.
- Provider-specific adapter declarations fill absent account facts.
- Exact public catalog matches fill remaining missing fields.
- Catalog alias or model-family matches remain suggestions until adopted.
- An explicit false or empty supported-tier list is not an unknown value.
- Operational defaults never establish capability evidence.
- A user limit cannot enlarge a known capacity. The preference is preserved,
  while execution uses the smaller limit and reports the limiting source.
- Public catalogs cannot switch the connection's wire protocol.

The editor changes only fields the user edits. Restoring automatic behavior
removes that field's override. Adopting a suggestion creates an explicit
preference and retains the suggestion's source and matching method.

Sources identify the provider/adapter/catalog, original field, timestamp,
matching specificity, and applicable scope where supplied. Unidentified
historical preferences remain protected with `legacy` provenance; migration
does not pretend they were verified user or provider declarations.

## Discovery and caching

`POST /v1/model-connections/{id}/probe` retains the compatible `models` string
array and additionally returns full model profiles, discovery source, and the
attempt status. Discovery does not execute a paid inference request.

`GET /v1/model-connections/{id}/catalog` returns discovery observations,
automatic catalog profiles, suggestions, effective profiles, and per-model
verification. `offset` and `limit` page model details. The selected model set
remains independent from the latest observed set.

Snapshots include a separate `metadataRevision`. SSE and long polling accept
`since_metadata_revision` alongside the configuration revision, so background
metadata updates reach GUI/TUI without changing configuration CAS semantics.
Metadata-only updates refresh views, not saved user preferences.
Public catalog warming batches notifications and bounds concurrent account
reads; unchanged catalog observations do not rebuild the model router.

The account cache is bound to effective connection configuration and credential
identity. A response started under a different identity cannot overwrite the
current observation. Identityless old account caches are historical only.
Successful empty lists stay empty. Failed refreshes retain the last successful
observation with its original timestamp and mark it stale. A successful source
refresh replaces that source's optional fields, including omissions.

The Runtime owns public catalog fetching, sanitation, matching, and cache
coordination. Main exposes compatibility adapters for temporary forms. Normal
startup does not write directory prices into user settings. Public metadata
refreshes and account model requests are independent: a slow public directory
does not hold up a successful model list. Existing six-hour public cache,
conditional requests, background refresh, size bounds, and the kun-agent
fallback remain supported. Public metadata never receives provider secrets.

Both account and public caches use Manager-owned persistence. Registry
metadata migration records `modelMetadataVersion: 1`, backs up the original
Registry to `model-metadata-v1-backup.json`, and is repeatable without deleting
selection, credentials, or overrides. New connection profiles capture facts
before operational defaults are applied.

## Input, output, and reasoning

Three values have distinct meanings:

| Field | Meaning |
| --- | --- |
| `contextWindowTokens` | Total context capacity |
| `maxInputTokens` | Maximum input capacity |
| `maxOutputTokens` | Maximum response capacity |

Input checks include system content, tools, dynamic context, history, and
attachments. Input must fit its own limit and the remaining context budget.
The ordinary output reservation remains bounded; it is not the entire maximum
output advertised by a directory. Actual output limits are separately capped
by the available total context. Existing soft/hard compaction policy remains
in force. Main-loop history may be compacted; auxiliary and gateway requests
are rejected on overflow without silently rewriting caller history.

An unknown window uses a clearly marked 1M execution estimate. The gateway
omits an unknown capacity instead of publishing this estimate as fact.

Reasoning support, selectable effort levels, and request encoding are separate.
Native levels and their default are retained alongside the compatible Kun
levels (`auto`, `off`, `low`, `medium`, `high`, `max`). Supported aliases include
`none -> off`, `minimal -> low`, and `xhigh -> max`; the request mapping preserves
the original supported wire value. A native `xhigh` default therefore becomes
Kun `max` and is sent as `xhigh` when supported by that adapter.

A reasoning boolean alone does not invent effort levels. Unknown native levels
remain descriptive metadata until the adapter supports them. Anthropic thinking
budgets and toggle encoding remain adapter responsibilities. Expanded windows
and SDK variants are conditional metadata, not default execution guarantees.

## Plans and subscriptions

Preset discovery policies distinguish live lists, live lists with a declared
fallback, preset-only lists, and manual configuration. The policy is scoped to
the provider's endpoint, product, plan, and region. Explicit connection settings
win. Custom full inference URLs have no inferred model-list URL.

Preset candidates are labelled unverified. A timeout, 404/405, rate limit, or
server error can use a permitted fallback. Authentication or authorization
failures remain failures, not successful discovery. Refresh does not delete
configured models merely because the current list omitted them.

Codex uses its account model catalog. Cursor and Claude use their official SDK
model controls without starting an agent turn. Only the executable default
Cursor variant contributes active capacity; alternatives stay conditional.
Claude's explicit model identifier is preserved; description-derived names are
hints, not replacement request IDs. Gemini CLI uses its existing Google account
query and credential path, with static candidates as a marked fallback.
Antigravity retains its independent CLI/account boundary.

## Public gateway and validation

`/v1/models` publishes known capacity, `max_input_tokens`, output capacity,
reasoning levels, and independently evidenced input/output modalities and tool
support. Public output contains no account identity or credential fingerprint.
A routed alias exposes the intersection of guaranteed capabilities and minimum
comparable capacity; unknown members prevent an unsupported guarantee.

Successful inference proves only the model/protocol/account actually used.
Success and failure timestamps are retained per model and protocol. Neither a
working credential file nor a readable catalog proves every listed model can
run. The existing explicit test action may send a bounded request; ordinary
refresh never does so.

Regression coverage includes persisted manual limits, smaller account limits,
identity changes, source replacement, empty catalogs, field-level false/unknown
semantics, native effort mappings, cross-provider suggestions, migration
idempotence, runtime/gateway capacity enforcement, and SDK discovery fixtures.
Fake upstreams and isolated profiles are used for automated checks; passing
fixtures do not claim verification of a real paid subscription.
