# Review related memories

Open an existing record in **Settings > Memory**, then expand **Related memories**.
Opening or refreshing this section reads saved suggestions; it does not call a model.
Choose **Analyze with model** to request suggestions using the runtime's configured
default model. A configured model may charge for this request.

The source record can **confirm**, **contradict**, or **extend** a target record.
These are directed suggestions, not verified facts. Shared keywords alone do not
establish a relation. Review both records and their highlighted, exact evidence
before choosing **Accept relation** or **Reject relation**.

Accepting a relation records a review decision only. It does not:

- edit either record or promote its authority;
- replace or automatically invalidate a fact;
- affect retrieval order, prompt injection, or model answers;
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

Forgetting or permanently erasing an endpoint scrubs associated relation references,
including affected derivative records and erasure retries. The existing canonical
forgetting barriers still prevent replay. Unreadable records or ledgers fail closed;
an IO error is not treated as evidence that a record was deleted.

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

Both endpoints require the existing runtime authentication and accept POST only:

- `/v1/memory/relations`: `list` or `review`, with a strict workspace/project access
  object. No caller-authored proposal, `all`, or agent-management privilege is accepted.
- `/v1/memory/relations/analyze`: Memory ID, expected revision, and access. The
  configured model generates suggestions; there is no caller-supplied model or prompt.

Conflicting/stale review or analysis returns 409. Unavailable storage/model operations
return a generic error without echoing record content or provider error payloads.
Refreshing is safe; analysis retry is another explicit provider request.

## Validation and future use

Backend tests cover schema rejection, scope/lifecycle fences, idempotence, stale
versions, forgetting/erasure, corrupt state, model output rejection, deadlines, and
the Manager HTTP round-trip. UI tests cover explicit-only analysis and stale/error
states. All supported locale resources include the new controls.

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

Using reviewed relations in a Working Context is separate future functionality.
It requires evidence about relation precision and target correctness, lifecycle
revalidation, provenance and context budgets. An accepted suggestion alone does
not authorize automatic context injection or ranking changes.
