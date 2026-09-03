## Why

Kun's P0 Memory foundation can safely persist, retrieve, explain, and recover explicit memories, but durable facts, preferences, and decisions still depend on a user or tool manually calling `memory_create`. The next step is to identify high-quality candidates from completed turns without allowing model inference, transient requests, credentials, duplicate facts, or rejected suggestions to become long-term memory silently.

## What Changes

- Add a strict, bounded model-facing candidate draft plus a host-bound `MemoryCandidate` using the existing Memory V2 types, authority, and source-evidence model.
- Add deterministic candidate normalization and eligibility checks that reject low-confidence, non-durable, credential-like, malformed, or source-less candidates.
- Bind source provenance and observation time from host-owned turn evidence, compare eligible candidates with authorized existing memories, and produce an explainable `create`, `update`, `supersede`, or `skip` decision without writing data.
- In a follow-up delivery within this change, run distillation only after a successful, durably completed turn, keep it off by default, and require the existing user approval flow before any MemoryStore mutation.
- Add anonymous multilingual fixtures and metrics for pre-approval writes, rejection behavior, duplicate creation, transient/sensitive false positives, source completeness, replay idempotency, scope isolation, and authority safety.
- Deliver the change in two reviewable slices: P1-A contains the candidate contract and pure decision core with no production wiring; P1-B adds TurnEnd coordination, settings, approval UI, persistence, and end-to-end acceptance.
- Keep embeddings, semantic reranking, memory relations, Working Memory, communities, Crystal generation, and silent autonomous writes out of this change.

## Capabilities

### New Capabilities

- `memory-distillation`: Bounded turn-derived Memory candidates, deterministic eligibility and duplicate/conflict decisions, approval-gated persistence, and reproducible safety/quality evaluation.

### Modified Capabilities

None.

## Impact

- Adds contracts and pure decision modules under `kun/src/contracts/` and `kun/src/memory/` in P1-A.
- Later P1-B work will extend the existing Kun turn lifecycle, approval/event surfaces, Memory settings, and `agents.kun` configuration without introducing a second runtime or Memory service.
- Reuses the P0 `MemoryRecord`, `MemoryType`, `MemorySourceEvidence`, scoped retrieval, lifecycle, and MemoryStore contracts; canonical JSON remains authoritative.
- Adds no production model call, automatic write, external service, embedding dependency, or schema migration in P1-A.
