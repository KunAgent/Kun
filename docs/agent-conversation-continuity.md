# Personal Agent conversation continuity

The public private-chat log is the durable source of truth. An execution thread
is a model/provider/account- and policy-scoped view of that conversation, not
its only copy. Native context compaction still owns model-visible tool history,
summary generation, tail retention, request estimation and bounded overflow
recovery. This change does not replace that mechanism or the external harness
session managers.

## Why a second continuity layer exists

A model-only switch keeps the execution thread. Changing provider/account or
policy can choose a different thread. Previously, only a newly created thread
received the latest 30 public messages, truncated to 1,500 characters each.
Returning A -> B -> A reused A without delivering B's intervening decisions.
The runner/real-loop regression reproduces that omission on the previous code.

Every newly admitted private turn now freezes a versioned, attributed reference
bridge. Both new and reused execution threads consume the unseen product-log
interval. The current user input is appended exactly once, unchanged. Native
inputs and publication results already owned by that execution thread are not
replayed as messages or executable tool calls.

## Storage and admission protocol

- `agent_conversation_preparation`: resumable per-request projection, with a
  fixed source boundary, scan watermark, bounded extractive outline and tail
- Immutable `context`: exact prepared bridge, followed by the existing exact
  run-input and memory-input snapshots
- `agent_conversation_cursor`: acknowledged product sequence per execution
  thread, bound to room and reset epoch
- Immutable bridge receipt: committed atomically with cursor advancement

Preparing a bridge cannot advance an acknowledged cursor. A known durable turn
receipt is required. Unknown enqueue outcomes keep the existing
`recovery_required` behavior; they do not resend or allocate another execution.
Restart reads the exact run-input snapshot, not the run's user-facing preview.
Repeated ticks replay the same bridge/receipt instead of retrieving new memory.

Preparation scans at most 16 message documents per tick and yields after a
50 ms processing slice. The database query also filters future source messages,
while including late publications from earlier requests. Cancellation is
rechecked by the runner before each resumed slice. A large old conversation
therefore needs multiple ticks before admission; no interval is silently skipped
to satisfy the work budget.

The acknowledged cursor stops before streaming or unadmitted holes. Later turns
can conservatively re-read reference excerpts beyond a hole until it resolves.
This overlap does not repeat the current prompt, create a turn, or execute a
historical tool call. Cursor metadata has constant size instead of accumulating
future queued-message IDs. Explicit retries remain new user-authorized attempts.

## Bounded recall and important work

The bridge is a deliberately lossy extractive outline plus recent references,
with original message IDs, status and truncation metadata. Its serialized UTF-8
budget follows the selected provider's explicit model capacity (or registered
profile), capped at 11 KB and normally 15% of the estimated context window. It
has a 512-byte minimum for metadata/recovery instructions. It never truncates
the current user prompt to make history fit.

Open same-room/epoch commitments are refreshed even when the list is empty, so
old summaries cannot silently revive completed work. At most four commitments
are included. A bounded scan and `moreCommitments` flag direct the Agent to the
existing list/get tools for the rest. Important outcomes must be deliberately
recorded with the existing commitment tools; an excerpt is not a guarantee that
every important detail was recognized automatically.

`read_agent_history` searches/pages the authoritative public log and reads long
originals using message IDs and UTF-16 offsets. Serialized-byte budgeting must
not advance pagination over an unconsumed row. The actual LocalToolHost checks
the active turn, recorded run, request, Agent member, room and current epoch.
Room reset/archive, Agent archive, Stop, and turn termination races revoke the
read before it returns. Group/other-Agent
histories, hidden setup messages and future queued user messages are excluded.
Retrieved text is reference data and grants no execution authority.

## Model capacity and recovery

Unregistered model capacity now defaults to a conservative 32,000-token
estimate, with a bounded one-time diagnostic per model name. Sparse profiles
receive the same fallback, including desktop settings projection. Previously
saved explicit capacities are preserved and should be verified for custom
endpoints. Set the actual `contextWindowTokens` in the model's
provider capabilities or `models.profiles` configuration, especially for
models below 32k. Known and explicit profiles retain their capacities.

Ordinary compaction output reservation is capped by one quarter of the safe
request cap. This prevents the previous small-window behavior where the 32k
output default consumed the whole input/output budget and forced compaction on
every turn. The actual forwarded output limit still honors the configured
capability, clamped to remaining request capacity.

Large -> small -> large switches reuse native compaction and re-evaluate the
current model each turn. Growing the window does not automatically expand old
summaries into all original text. Token estimation is heuristic. If the fixed
system/tools, current message, attachments, or an upstream tokenizer still
exceed capacity, the turn fails with concrete configuration/input/tool/model
recovery guidance. Overflow retries remain bounded to one, and committed
partial output is never automatically replayed. Saved conversation originals
are retained.

## Verification

Focused tests cover A -> B -> A, repeated provider/account changes, durable
commitment refresh, 18 large/small/large turns, lost enqueue receipts, restart
mid-preparation, bounded large gaps, cancellation before admission, late and
streaming publications, future messages, cross-room/reset isolation, escaped
pagination, long original retrieval, and LocalToolHost reset/archive/cancellation races.

These are deterministic real runner/loop/store tests with scripted models.
They do not prove every live provider tokenizer, remote SDK, or model's ability
to choose useful recall tools. No claim of infinite verbatim model memory is
made. The archive and structured commitments remain the recovery sources.
