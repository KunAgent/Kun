## Context

P0 established canonical Memory V2 JSON, rebuildable SQLite/FTS5 projection, bounded lexical retrieval, scope and lifecycle filtering, reference-only prompt injection, provenance, recovery, and manual Memory management. It intentionally left automatic extraction out of production. Today a durable fact becomes Memory only through the explicit UI/import path or an approved `memory_create` tool call.

P1 adds a controlled pipeline: completed-turn observation, candidate extraction, eligibility checks, comparison with authorized existing memories, independent user approval, and only then a MemoryStore mutation. The work is split into P1-A and P1-B so the data contract and deterministic safety core can be reviewed before any runtime behavior changes.

The core cannot reliably infer arbitrary semantic contradiction from lexical overlap. P1 therefore treats model-produced comparison relations as untrusted structured input, validates their target ids against records returned by the existing scoped retrieval path, and leaves the final action selection to deterministic host code. Approval remains mandatory for every non-skip result.

## Goals / Non-Goals

**Goals:**

- Define a strict, bounded candidate and comparison contract using existing Memory V2 types and host-owned source evidence.
- Normalize candidate data deterministically for stable fingerprints, replay behavior, and evaluation.
- Reject credentials, transient requests, and low-confidence candidates before approval.
- Produce explainable `create`, `update`, `supersede`, or `skip` decisions without side effects.
- Preserve host-owned scope, observation time, source provenance, lifecycle filtering, and `authority=reference`.
- Specify the later TurnEnd, model budget, approval persistence, and replay behavior before wiring it.
- Measure safety and duplicate behavior with anonymous multilingual fixtures.

**Non-Goals:**

- P1-A does not call a model, TurnEnd hook, approval gate, MemoryStore, renderer, or settings path.
- P1 does not add embeddings, semantic reranking, graph relations, Working Memory, communities, Crystal generation, or silent writes.
- P1 does not expand `MemoryType`; plans, processes, and learning remain represented through the current type plus tags.
- P1 does not grant model output control over scope, project paths, provider credentials, observation time, source provenance/trust, or authority.
- P1 does not claim that lexical similarity alone can prove semantic equivalence or contradiction.

## Decisions

### 1. Deliver one OpenSpec change as two sequential PRs

P1-A contains this complete proposal/design/spec plus candidate contracts, pure normalization/decision code, fixtures, and evaluation. It changes no production execution path. P1-B starts from develop after P1-A merges and adds runtime coordination, settings, pending approvals, UI, persistence, and end-to-end acceptance.

This keeps the architecture coherent in one change while preserving a small first review boundary. Tasks are grouped and checked by delivery slice; the change is archived only after P1-B is merged and accepted.

### 2. Keep the candidate smaller than a Memory record

The model-facing `MemoryCandidateDraft` contains only content, type, confidence, importance, tags, and one to eight source ids selected from the current host-provided turn evidence. It cannot contain an id, observation or persistence timestamps, full source records, scope/path, lifecycle state, supersession target, or authority. Before deciding, the host resolves every source id to its authoritative evidence and supplies the turn observation time. The resulting `MemoryCandidate` contains those bound sources and time. The host adds identity, audit time, and target scope after approval, while MemoryStore continues to force `authority=reference`.

P1-A bounds content to 4,096 characters, tags to 16 values/64 characters, and source ids/resolved sources to the existing Memory V2 limit of eight, and rejects unknown fields. Text uses NFKC, CRLF normalization, trimming, and bounded whitespace normalization. Tags are lower-cased, de-duplicated, and sorted; source ids and resolved sources are sorted after strict duplicate-id validation. This yields a stable normalized representation while source kind, trust, thread, turn, locator, and excerpt remain host-owned.

### 3. Separate durability and comparison claims from canonical candidate data

The extraction envelope contains a candidate draft, a durability value (`durable` or `transient`), and up to eight relations to potential existing records (`duplicate`, `update`, or `supersede`). These are model claims, not Memory fields. P1-A validates them, resolves draft source ids only from host-owned turn evidence, and rejects missing source ids or future/invalid host observation times. P1-B will only accept relation targets found in the current host-owned, scope/lifecycle-filtered retrieval result.

The core additionally detects bounded transient-request cues and common credential forms in content and source text. These deterministic checks override a model claim that an item is durable. Confidence below `0.6` also skips. Malformed data fails validation rather than silently becoming a create decision.

### 4. Make final action selection deterministic

The decision order is:

1. Reject invalid envelopes or unavailable/inactive comparison targets.
2. `sensitive` skip.
3. `low-confidence` skip.
4. `non-durable` skip.
5. Exact normalized content or an explicit duplicate relation -> `duplicate` skip.
6. A validated supersede relation -> `supersede`.
7. A validated update relation -> `update`.
8. Otherwise -> `create`.

Within one relation class, the lexicographically smallest memory id wins after normalization, so array order cannot change the outcome. P1-A only returns a proposed decision; P1-B must show its candidate, sources, target, and reason before writing.

### 5. Reuse the initiating Kun model route with a hard budget

P1-B will call the existing runtime `ModelClient` using the provider/model route resolved for the completed turn. It will not add a renderer HTTP client, separate provider setting, or secondary credentials. The request has no tools, uses strict JSON/deterministic sampling, includes only current-turn user and assistant text plus opaque allowed source ids, and is limited to 24,000 input characters, 2,048 output tokens, eight candidates, 15 seconds, and one attempt per eligible turn. The model cannot supply full evidence records or their trust metadata.

The call is scheduled only after the turn is durably persisted as completed. It is asynchronous and cannot delay or reverse completion. Timeouts, provider errors, invalid JSON, and invalid candidates become sanitized bounded diagnostics and zero pending candidates. This bounds both incremental cost and failure impact to at most one short provider request per eligible opted-in turn.

### 6. Persist pending approvals and terminal rejections independently

P1-B will store pending candidate envelopes outside canonical Memory records. The idempotency key is a SHA-256 fingerprint over thread id, turn id, and the normalized candidate. Pending entries survive restart. Each candidate has its own state even if the UI offers allow-all or deny-all controls.

Only `allow` may call MemoryStore. Deny, timeout, expiry, or withdrawal before persistence writes a terminal non-writing outcome so replay cannot reopen it. Approval history is append-only. If an already-approved Memory must be withdrawn later, the user uses existing disable/delete/supersede lifecycle operations; the prior approval is not rewritten.

### 7. Keep scope, evidence, and comparison membership host-owned

Candidate output carries no scope or full source record. The coordinator derives the target from current user/workspace/project context, creates authoritative current-turn evidence, and calls the existing Memory retrieval surface. It passes the core that evidence plus only active records returned for the access context. The core resolves every candidate source id against the host evidence and validates every comparison id against the active record set, failing closed on any missing target. This prevents a model from forging explicit-user provenance, naming another turn or a cross-workspace id, or reviving a disabled, expired, deleted, or superseded record.

### 8. Use anonymous deterministic evaluation before production wiring

P1-A fixtures cover English and Chinese facts, preferences, decisions, transient requests, low-confidence inferences, credentials, duplicate facts, metadata updates, and conflicting replacements. The evaluator measures exact expected action/reason, unsafe non-skip count, duplicate create count, and source completeness. P1-B extends the same corpus with approval, scope, restart, replay, and failure-path tests.

## Risks / Trade-offs

- **Relation quality depends on structured extraction.** A model can label a relation incorrectly. -> Restrict targets to authorized active retrieval results, validate strictly, show the relation and sources to the user, and require approval before mutation.
- **A model can invent provenance fields.** -> Accept only opaque source ids in model output, resolve them from host-owned current-turn evidence, and reject unknown ids before approval.
- **Credential regexes can have false positives or miss novel formats.** -> Prefer conservative skip behavior for assignment/token forms, test common benign discussions, and never log rejected source bodies.
- **A 15-second background request can still add cost.** -> Default the feature off, make one capped call only after successful completion, expose no retries in the first version, and report the limit in settings/PR evidence.
- **Persisted pending candidates add state.** -> Use deterministic fingerprints, bounded records, terminal outcomes, and a separate store so incomplete suggestions never become canonical Memory.
- **Two PRs leave an unarchived change between merges.** -> Mark P1-A tasks separately, keep P1-B tasks unchecked, and archive only after the full capability is accepted.
- **Strict validation may discard useful but malformed candidates.** -> Fail closed and record aggregate sanitized diagnostics; do not coerce unknown fields into a potentially unsafe write.

## Migration Plan

P1-A adds unused exported pure modules and tests, so it requires no data or settings migration and can be reverted without changing runtime state. P1-B will add an opt-in setting defaulting to false and a versioned pending-candidate store. Existing Memory V2 JSON and SQLite projection remain unchanged. Removing P1-B disables new extraction while leaving approved Memory records manageable through existing lifecycle operations.

## Open Questions

- Whether the first UI should present approvals individually or in a list with bulk controls; storage and audit semantics remain per-candidate either way.
- The final pending-approval expiry duration and cleanup cadence; timeout/expiry must remain terminal and non-writing regardless of the selected duration.
