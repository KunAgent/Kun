# Review related memories

Open an existing record in **Settings > Memory**, then expand **Related memories**.
Opening or refreshing this section reads saved suggestions; it does not call a model.
Choose **Analyze with model** to request suggestions using the runtime's configured
default model. A configured model may charge for this request.

The source record can **confirm**, **contradict**, or **extend** a target record.
These are directed suggestions, not verified facts. Shared keywords alone do not
establish a relation. Review both records and their highlighted, exact evidence
before choosing **Accept relation** or **Reject relation**.

Accepting a relation records your review decision. By default it remains available
only for browsing and preview. Acceptance does not:

- edit either record or promote its authority;
- replace or automatically invalidate a fact;
- change retrieval order or retrieve extra memories;
- create an embedding index or a knowledge graph.

Use the existing Memory correction/lifecycle controls when a fact needs changing.
A contradictory relation does not determine which record is true.

## Privacy and limits

Analysis is opt-in per request. There are no automatic calls on creation, correction,
application startup, or panel expansion.

The configured provider receives the selected record's ID/content and at most eight
target IDs/contents. Targets must be authorized, active, non-agent-private reference
memories in the same scope and ownership. Directive memories are excluded. A
workspace relation cannot cross workspaces; project-wide records must share the
canonical project identity.

Discovery takes a limited window of up to 200 recent records visible to that access,
then selects same-scope candidates with lexical overlap. Records longer than 2,000
JavaScript string characters are excluded, not silently truncated. Zero-overlap,
cross-language connections and older records can be missed. An empty result does
not establish that no relation exists.

The model has no tools, a 2,048-token output budget, a 20-second application deadline,
and a strict eight-suggestion JSON contract. Only one analysis request per runtime
is admitted at a time. Cancellation requests are forwarded to the adapter; late
output cannot persist suggestions, even if an adapter ignores cancellation.
The original deadline and cancellation are checked after waiting for storage and
again immediately before the atomic ledger commit, including in managed mode.
Cancellation cannot undo a write that already crossed that commit boundary.
Provider-side cancellation and actual billing remain provider-dependent.

Every quote must be an unambiguous, exact substring of a supplied record. Unknown
targets, tools, invented/ambiguous quotes, duplicate targets, oversized responses,
or incomplete output reject the batch. Quote validation proves that the text exists,
not that the proposed relationship is semantically correct.

## Versions, decisions, and deletion

Suggestions are bound to both record revisions and canonical fingerprints. An edit,
rollback, disable, expiry, or supersession makes the old suggestion stale. Stale
suggestions expose no old quotes or source excerpts and cannot be accepted.
Refresh or analyze again to inspect the current records.

Review is idempotent. A different decision cannot overwrite a decided pair/version.
Re-analyzing the same directed pair/version cannot replace a prior rejection with
a new model label. A new record version may generate a new suggestion.

Filter the browser by pending, accepted, rejected, or stale. **Withdraw acceptance**
explicitly rejects a previously accepted relation, including a stale one. This stops
future use without changing either record. The same pair/version remains rejected
on re-analysis; withdrawal does not rewrite past chat context.

The browser loads 20 relations per page, newest first. Filtering is applied before
pagination, not just to the visible page. **Previous** and **Next** keep older
decisions reachable, including accepted relations beyond the first 200. Refresh
or reopen the browser to restart at the newest page. Pages are live views, not a
snapshot: concurrent decisions can change filtered membership. Stable creation-time
and ID cursors avoid shifting older records when a newer entry is inserted or the
cursor's entry is removed. A stale accepted relation remains withdrawable under
the stale filter.

Forgetting or permanently erasing an endpoint scrubs associated relation references,
including affected derivative records and erasure retries. The existing canonical
forgetting barriers still prevent replay. Unreadable records or ledgers fail closed;
an IO error is not treated as evidence that a record was deleted.

Canonical forgetting/erasure commits before optional relation cleanup. If the
relation ledger is damaged, oversized or unreadable, content erasure still removes
canonical files and attempts SQLite removal; the operation reports incomplete
cleanup rather than success. The unreadable ledger is preserved. Restore its
readability and retry the same erasure to finish reference cleanup. Ordinary
relation commands inspect only involved endpoints, so an unrelated damaged record
does not block browsing or reviewing a healthy pair.

The local versioned ledger is `memory/relations/suggestions.json` under the runtime
data directory. It stores IDs, hashes, quote offsets, relation types, timestamps and
decisions, not copies of Memory content. Evidence is resolved from currently
authorized canonical records. The ledger is bounded to 2,000 suggestions and 2 MB;
when full, analysis cannot persist further entries. Existing decisions are not
silently evicted. There is no automatic retention cleanup in this version.

In managed mode, the Manager owns mutations through the existing shared Memory
store. The renderer and runtime do not create a second file writer. A Manager that
does not support relation commands must be updated/restarted; the runtime does not
fall back to writing the ledger itself.

## API

All endpoints require the existing runtime authentication and accept POST only:

- `/v1/memory/relations`: `list`, `review`, or `withdraw`, with a strict workspace/project access
  object. No caller-authored proposal, `all`, or agent-management privilege is accepted.
  Lists accept optional `limit` (1-200, default 200), `status`, and `before`
  (`createdAt`/`id`) fields. Use the returned `nextCursor` as the next `before`;
  its absence means there are no further visible matching relations at that moment.
- `/v1/memory/relations/analyze`: Memory ID, expected revision, and access. The
  configured model generates suggestions; there is no caller-supplied model or prompt.
- `/v1/memory/context/preview`: query and workspace path. The server selects records;
  callers cannot supply selected IDs, authority, or agent-management privileges.
  Responses are `no-store` and exclude directives.

Conflicting/stale review or analysis returns 409. Unavailable storage/model operations
return a generic error without echoing record content or provider error payloads.
Refreshing is safe; analysis retry is another explicit provider request.

## Preview and controlled automatic context

In **Settings > Memory > Context preview**, enter a workspace path and query.
Preview uses the same relevance-gated reference selection and relation assembly
as chat, but does not call a model, record retrieval feedback, change last-injected
diagnostics, or include long-term rules. It is a snapshot, not a guarantee about a
later turn. Editing the inputs, canceling, or changing settings clears the snapshot.

**Include reviewed relations in chat** is off by default. The GUI persists
`memoryRelationContextEnabled`; the runtime capability is
`capabilities.memory.relationContextEnabled`. Both require master Memory to be on.
Turning it off takes effect on subsequent context assembly; it cannot remove
information already sent in an in-flight turn or retained in conversation history.

When enabled, native Kun, Agent SDK and Cursor SDK attach the same bounded annotations:

- Both endpoints must already be selected by ordinary retrieval. No additional
  recall, graph traversal, re-ranking, or summaries are performed.
- Both must remain authorized, active, same-ownership reference records with
  matching revisions/fingerprints. Private and directive records are excluded.
- The accepted evidence spans must remain present in the selected text, including
  when retrieval truncated a record.
- Annotations contain relation kind, endpoint IDs/revisions, relation ID and review
  time. They do not duplicate content or promote it to user/system authority.
- At most six annotations and 1,600 characters fit inside the remaining 6,000-character
  reference budget. Existing reference records are never evicted for annotations.
- Projection reads the bounded ledger once and checks only the relevant selected
  endpoints. It does not scan all canonical memories or write derived context.
- Unavailable/old Manager, invalid ledger or a one-second projection deadline drops
  only optional annotations. Ordinary reference context remains available. Rooms
  retain their existing Memory-free boundary.

A contradiction remains unresolved: the annotation explicitly says not to choose
a winner or merge conflicting facts. Annotations are untrusted, user-reviewed
metadata, not verified truth. They can still influence model answers; opt-in and
bounded size do not prove semantic correctness or eliminate model mistakes.

The chat's used-memory details retain the IDs/revisions actually injected, distinct
from preview and from current records. A later edit or withdrawal does not rewrite
this historical provenance.

## Validation and limits

Backend tests cover schema rejection, scope/lifecycle fences, idempotence, stale
versions, forgetting/erasure, corrupt state, model output rejection, deadlines, and
the Manager HTTP round-trip. UI tests cover explicit-only analysis and stale/error
states, preview cancellation, withdrawal and malformed history metadata. All seven
locale resources include the new controls; new context copy is localized in English
and Chinese, with English fallback text in the other five resources.

For a repeatable component integration smoke:

```sh
CHROME_PATH=/path/to/chrome node scripts/smoke-memory-relations.mjs
```

On Windows Command Prompt:

```bat
set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
node scripts/smoke-memory-relations.mjs
```

Screenshots and a result summary are written to `output/playwright/memory-relations`
(override with `KUN_MEMORY_EVIDENCE`). The smoke uses the real panel, renderer client,
route and FileMemoryStore with isolated synthetic data and a deterministic mock
provider. It does **not** validate real model quality or the full packaged Electron
preload/Manager path. Manager ownership has separate integration coverage.

These checks establish plumbing and safety invariants, not measured improvements in
real model answers or relation precision. The default remains off pending voluntary
use and review. Acceptance alone does not enable the switch or authorize ranking
changes. Embedding ranking, feedback ranking, Crystal/community detection and graph
expansion are outside this feature.
