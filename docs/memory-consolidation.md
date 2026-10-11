# Evidence-grounded Memory consolidation

## Canonical data and authority

Memory records remain canonical. Consolidation extends the existing ordinary
turn distillation and Rooms capture jobs; it does not create a second agent,
scheduler, or model authority. A new completed session can propose an update or
supersession of a visible prior-session record. The proposal carries a bounded
reason explaining the changed decision, canonical `sourceMemoryIds`, all cited
source IDs, and source session IDs. New records stay reference memories.
Consolidation never adds sharing, changes an agent owner, or promotes a reference
to a directive. User corrections and locked agent memories need explicit review.
Canonical fingerprints are checked again at apply, inside the mutation queue.

Existing durable job IDs, source-event cursor, capture checkpoints, pending
approval receipts, and deterministic memory IDs provide restart idempotence.
Rooms capture retries at most twice per root request/generation; interruption is
recorded as failure, not successful capture. Cancellation aborts the model call
and prevents its results from being applied.

## Evidence provenance

`MemorySourceEvidence` retains `id`, `threadId`, `turnId`, `itemId`, locator,
excerpt, hash, and trust. Optional host-owned provenance adds:

- `receiptId`: exact persisted tool-result ID or Rooms delivery verification ID
- `repositorySha`: validated 40/64-character revision when the receipt has one
- `artifactIds`: persisted execution log or diff artifact identifiers
- `outcome`: `succeeded`, `failed`, `aborted`, or `unknown`

Ordinary turn capture reads actual tool results, not assistant descriptions of
tools. Exit zero on a completed command result supports observed success;
errors, nonzero exits, and aborted results cannot. Missing exits or generic read
tools remain unknown. Rooms capture validates delivery verification records:
passing evidence requires exit zero, completion time, and a persisted log
artifact. Delivery summaries and reviewer verdicts remain inferred claims.
Receipts are prioritized ahead of assistant prose in the bounded source window.

`consolidation.evidenceStatus` distinguishes `observed-success`,
`observed-failure`, `aborted`, `unverified`, and `user-stated`. An assistant claim
alone never produces observed success. Explicit success claims without adequate
receipts, and claims that hide failed/aborted current evidence, are rejected.
This is a conservative provenance gate, not a general proof of semantic
entailment. A receipt verifies only the operation represented by that receipt.

Source text is untrusted data. The extraction model has no tools; invented
source/target IDs, authority or scope fields, credential-shaped content, and
obvious permission-changing instruction injection are rejected. Model-provided
comparison reasons are checked as well as candidate content.

## Bounds and progressive recall

Ordinary extraction: 24,000 input characters, 2,048 output tokens, 32,768 output
characters, 15-second timeout. Rooms extraction: 16,000 input bytes, 2,400 output
tokens, 16,000 output characters, 20-second timeout. Both permit at most eight
candidates and eight sources per candidate. Comparison eligibility permits up to 12,000 serialized bytes for the current
record excluding history, plus a hard 208,000-byte limit on each complete
canonical snapshot (at most eight snapshots, approximately 1.7 MB total).
The snapshot ceiling accommodates the existing 64,000-serialized-character
history limit even for three-byte UTF-8 text without changing retention. Full snapshots, including retained
history, are preserved for fingerprint/CAS checks; model input includes only
bounded current-content projections, never revision history. Oversized current
bodies or complete snapshots are excluded. A consolidation that exceeds source/lineage budgets fails
closed rather than silently dropping provenance.

The topic index is a derived, rebuild-only view of current canonical records.
Visibility and active lifecycle checks precede grouping. It is bounded to 256
records, 24 topics, and eight IDs per topic; it is not an exhaustive database
count. `memory_topics` exposes a bounded active window, `memory_list` enumerates
beyond it, and `memory_read` expands a selected ID. Deleted, disabled, expired,
superseded, or foreign-scope records do not survive a rebuild. Topic expansion
resolves IDs against fresh canonical records rather than trusting an old index.

## Input receipts and forgetting

Rooms saved run context includes an optional `memoryReceipt` with the exact
selected memory IDs, canonical fingerprints/revisions, source IDs, and hash of
the prepared memory text. Its state is `prepared-input`: it proves inclusion in
the saved input, not that the model relied on a memory. Legacy runs without a
receipt remain unknown; management eligibility is never treated as usage.

Forgetting barriers are checked before extraction results are persisted,
listed, or applied. Pending files remove forgotten candidate payloads while
retaining non-content run identities against restart replay. Agent capture
snapshots and candidate jobs are replaced with non-content terminal receipts;
in-flight results are checked again before write. Canonical forgetting also
follows `sourceMemoryIds` to derived records. Historical conversation archives
are not rewritten by these memory operations.

Source-level recapture barriers require a precise item, execution receipt, or
anchored locator. Where an excerpt is present, the barrier binds that normalized
statement to the source unit; changing a memory-local evidence ID does not evade
it. A bare thread/turn or standalone content hash can cover many facts and is
never treated as one forgotten statement. Existing non-derivative records are
not hidden merely because they share provenance with a forgotten record.

This is a deliberate precision boundary: without an excerpt, future writes from
the same precise source unit are conservatively blocked because the store cannot
distinguish separate statements inside it. With only coarse turn provenance,
the barrier still covers the forgotten record ID, same-scope exact normalized
content, and explicit derived lineage, but cannot recognize every paraphrase.
The store does not guess semantic equivalence or erase unrelated sibling facts.

## Regression coverage

- Multi-session decision supersession with changed rationale and source lineage
- Restart replay without duplicate model calls or canonical records
- Concurrent human edits and locked agent correction protection
- Failed/aborted work, assistant-only claims, exact SHA/log receipt preservation
- Model tool attempts, invented IDs/authority, credential/instruction rejection
- Input/output/source limits and stale topic visibility
- Forgotten pending payload removal, stale-cache replay, and saved-input receipts

Tests: `memory-consolidation.test.ts`, `agent-memory-evidence.test.ts`, existing
Memory distillation/concurrency suites, and agent-memory coordinator/service/
candidate suites.
