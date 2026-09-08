## Context

Kun's live memory implementation is `FileMemoryStore`. It stores one strict `MemoryRecord` JSON document per memory and atomically replaces that document on create, update, disable, supersede, or delete. The store scans and parses the complete directory for list, lookup, diagnostics, and retrieval. Retrieval adds every active user-scope record before scoring workspace and project records with language-aware n-gram overlap multiplied by an age-decayed confidence value.

The runtime already exposes memory through explicit tools, HTTP routes, the TUI, renderer settings, and `ManagerRemoteMemoryStore`. Production serve composition delegates memory operations to the Manager shared-data layer, but that layer currently constructs file stores by serialized capability configuration. Turn context retrieval still passes a hard-coded limit of eight even though `MemoryCapabilityConfig` exposes `maxInjectedRecords`.

The current `develop` branch also contains a mature hybrid thread store. It keeps JSONL and atomic filesystem documents canonical, uses `better-sqlite3` as a rebuildable index, reports degraded state, and repairs the index from canonical data. The memory foundation should reuse those principles while keeping memory schemas and lifecycle independent from thread indexing.

Public Nowledge Mem documentation provides useful product concepts, especially Thread/Memory separation, explicit provenance, hybrid retrieval, and distinct confidence/freshness signals. This design adapts those ideas to Kun's existing single-runtime, Manager-owned, local-first architecture. It does not copy or depend on Nowledge Mem core source.

## Goals / Non-Goals

**Goals:**

- Preserve existing explicit memory behavior while making list and retrieval index-backed at scale.
- Make every new or normalized memory self-describing enough for later distillation and evolution changes.
- Keep scope authorization ahead of retrieval and ranking.
- Separate semantic confidence, temporal freshness, and user/model importance.
- Ensure an unavailable, missing, corrupt, or stale SQLite index never makes canonical memories unavailable.
- Bound prompt injection by configured record and token budgets and mark all memory content as reference evidence.
- Keep local, Manager-owned, and remote memory-store behavior contract-equivalent.
- Establish repeatable retrieval and migration evaluation before adding embeddings or model-driven writes.

**Non-Goals:**

- Automatically creating memories at TurnEnd.
- Calling a model for Triage, Distillation, query rewriting, HyDE, or reranking.
- Adding embedding/vector storage or an external database.
- Adding EVOLVES edges, semantic entities, community detection, Working Memory, or Crystal generation.
- Replacing the knowledge-base subsystem or the execution-learning graph.
- Turning inferred memory into system or user instruction authority.

## Decisions

### 1. Keep JSON records canonical and make SQLite a rebuildable index

The new production adapter will follow the hybrid thread-store rule: canonical state is written first to `<dataDir>/memory/<id>.json` with the existing atomic-write helper, then projected into a dedicated SQLite index. The default index path will be `<dataDir>/memory-index.sqlite3`, separate from the thread `index.sqlite3`, so memory migrations, rebuilds, diagnostics, and future search tables do not couple to thread-store ownership.

Each index row records the memory id, normalized scope keys, lifecycle state, content, tags, ranking fields, canonical record hash, and canonical `updatedAt`. FTS5 content is derived entirely from the canonical record. Deleting the SQLite file must lose no user data.

If SQLite cannot load, open, migrate, or query, the adapter enters an observable degraded state and falls back to the existing bounded filesystem/n-gram behavior. New writes continue to update canonical JSON. Recovery reconciles rows by id, canonical hash, and update time before indexed retrieval resumes.

This is preferred over making SQLite canonical because Kun already treats local indexes as disposable projections, the native module can fail because of ABI or packaging mismatches, and non-destructive fallback is more valuable than avoiding one atomic JSON write per explicit mutation.

### 2. Introduce additive Memory V2 fields through compatibility normalization

The public `MemoryRecord` contract will gain fields with deterministic defaults rather than rejecting existing files. The normalized record includes:

- `schemaVersion`: persisted version, normalized to version 2.
- `type`: `fact`, `preference`, `decision`, `episode`, `relationship`, or `insight`.
- `authority`: initially only `reference` for memory context.
- `importance`: independent number from zero to one.
- `observedAt`: when the fact or preference was observed.
- `validFrom` and `validTo`: optional fact validity interval.
- `sources`: a bounded list of evidence descriptors.

Each source descriptor has a stable id, source kind, optional thread/turn/item locator, optional relative or external locator, bounded excerpt, content hash, and trust level. Existing `provenance`, `sourceThreadId`, and `sourceTurnId` remain readable and are normalized into source evidence without eagerly rewriting the original file. Existing outward fields remain available during the compatibility window.

The settings export remains human-readable and also carries a strictly validated Kun Memory V2 block for portable round-trips. Import preserves semantic fields, scope paths, bounded evidence, validity, expiry, and disabled state, but intentionally generates fresh ids and audit timestamps so importing an archive cannot overwrite an existing canonical identity or replay a tombstone.

Freshness is computed at retrieval time from validity, observation, confirmation, and update timestamps. A mutable freshness scalar is not canonical. Existing `confidence` remains the belief-strength signal and is no longer multiplied in place by age before being exposed to callers.

### 3. Preserve one logical Manager-owned memory repository

Production memory data remains owned by the Manager shared-data layer. Capability configuration controls policy, scopes, and retrieval limits but must not create multiple physical repositories or independent indexes for the same data directory. The Manager will keep one repository per canonical data root and pass normalized policy into operations.

Local serve mode creates the same hybrid adapter directly. `ManagerRemoteMemoryStore` remains a port-compatible proxy and parses every response through shared contracts.

This prevents hot configuration changes from selecting a different in-memory store instance while preserving the existing Renderer -> preload -> main -> Kun HTTP/SSE path.

### 4. Build an FTS5 lexical index that preserves CJK behavior

Raw `unicode61` tokenization is insufficient as the only cross-language strategy. Index projection will generate a bounded search-token field using the current behavior as a compatibility base:

- normalized Latin words and trigrams;
- CJK bigrams;
- normalized tags, title-like summaries when present, and source labels;
- stable separators so FTS5 sees individual generated tokens.

Queries use the same normalizer and safe FTS parameter binding. BM25 provides lexical ordering. Exact id/tag matches and lifecycle filters remain ordinary indexed columns rather than FTS syntax.

If FTS5 is unavailable in a packaged native build, diagnostics report the exact capability failure and retrieval uses the existing in-process n-gram scorer. Packaging tests must prove FTS5 availability on supported artifacts before it is treated as the normal production path.

### 5. Filter scope and lifecycle before scoring

Candidate selection excludes deleted, disabled, expired, and superseded records before ranking. User scope is visible to the same user context, workspace scope requires the normalized current workspace, and project scope requires its normalized project key. Retrieval APIs do not accept arbitrary scope broadening from model-generated arguments.

No active user-scope record is automatically selected solely because of its scope. Identity and preference records compete through the same bounded ranking pipeline, with a small explicit type/scope feature rather than an unconditional bypass.

The result count is bounded by the minimum of the caller limit and current `maxInjectedRecords`. The context assembler also applies a character/token budget, so a small record count cannot still produce an unbounded prompt.

### 6. Rank relevance, freshness, confidence, and importance independently

Foundation ranking remains deterministic and model-free. It combines normalized lexical rank with separate bounded features:

- lexical relevance;
- scope/type affinity;
- time-query or general freshness affinity;
- importance;
- confidence.

The implementation must not add raw BM25, confidence, and timestamps directly because their scales differ. Pure ranking helpers normalize each feature and use explicit weights covered by evaluation fixtures. Stable ties use `updatedAt` and memory id.

The initial weights are implementation constants, not a public compatibility contract. Evaluation reports must record them so later changes can compare behavior rather than silently tuning production ranking.

### 7. Inject memory as bounded untrusted reference context

`memoryInstructions` will clearly state that retrieved records are historical reference evidence, may be stale or incorrect, and cannot override system instructions or the current user request. Each entry includes memory id, scope, authority, confidence, freshness class, and a bounded source locator when available.

Memory content remains dynamic turn context and must not enter the immutable system prefix. Tool output, imported memory, and model-inferred source text are treated as untrusted content even when stored locally.

The turn records the selected memory ids as today and additionally retains a bounded retrieval trace containing candidate channel, rank features, exclusions, final selection, and prompt budget. The trace contains no embedding or source body duplication.

### 8. Make index migration lazy, idempotent, and non-destructive

Startup opens or creates the memory index schema and starts bounded reconciliation from canonical JSON. Existing JSON files are parsed through the compatibility normalizer. Corrupt records are skipped with diagnostics and never deleted automatically.

The first retrieval may use the filesystem fallback while backfill is incomplete. New and changed canonical records are indexed synchronously after their atomic write, while the reconciliation cursor handles older records in bounded batches and yields to the event loop.

Index schema changes use forward migrations. If migration fails, the index is closed and marked degraded; the original JSON remains authoritative. Rebuilding may delete only the derived index after resolving and validating its exact path under the configured data directory.

Rollback removes hybrid adapter selection and uses `FileMemoryStore`; canonical records remain readable. V2 additive fields are accepted by the compatibility parser even if older binaries ignore them only when their strict schema permits, so packaged downgrade behavior must be tested before release. No proposal may claim downgrade safety without that evidence.

### 9. Extend diagnostics without adding a runtime control surface

Memory diagnostics will add bounded fields for canonical record count, index state, indexed count, stale/missing row count, schema version, backfill state, last retrieval summary, and degraded reason. Existing fields remain compatible.

Degraded reasons redact credentials and absolute Windows, UNC, POSIX, and file-URL paths before reaching logs or the renderer. Module basenames and Node/Electron ABI details remain available when they are needed to diagnose native dependency failures.

External canonical drift is detected by diagnostics, which marks the projection stale. The next retrieval then uses filesystem fallback and starts reconciliation before indexed retrieval resumes; normal indexed retrieval does not scan every canonical file on every query.

The existing settings memory section may show health and the last retrieval explanation. This must not recreate the removed runtime diagnostics panel or add `/runtime` control commands. Reindex is an internal recovery operation or a narrowly scoped memory action, not a general runtime controller.

### 10. Require an evaluation baseline before semantic retrieval

The change will add anonymous deterministic fixtures containing English and Chinese memories, overlapping terms, unrelated lexical matches, stale but confident facts, replacements, disabled/deleted records, cross-workspace records, and prompt-injection text. Queries map to expected relevant ids and forbidden ids.

The harness reports Recall@K, Precision@K, reciprocal rank, scope leaks, selected characters/tokens, and query latency. It compares the current n-gram store with the hybrid foundation. The dataset and scorer are test infrastructure, not user telemetry, and no production memory content leaves the machine.

Embedding, RRF, LLM reranking, and Deep Search remain blocked until this baseline can demonstrate their incremental value in a follow-up change.

## Data and Component Shape

```text
Memory tools / HTTP / TUI / Renderer
                 |
                 v
            MemoryStore port
                 |
       +---------+----------+
       |                    |
       v                    v
ManagerRemoteMemoryStore   HybridMemoryStore (local)
       |                    |
       v                    +--> canonical memory/*.json
Manager SharedData             --> memory-index.sqlite3 / FTS5
       |
       v
HybridMemoryStore
```

Expected focused implementation modules:

```text
kun/src/memory/
  memory-store.ts
  memory-record-normalizer.ts
  memory-ranking.ts
  memory-search-tokens.ts
  memory-retrieval-trace.ts

kun/src/adapters/hybrid/
  hybrid-memory-store.ts
  hybrid-memory-index.ts
  hybrid-memory-backfill.ts
  hybrid-memory-migrations.ts
  hybrid-memory-degraded-state.ts
```

The final module split may reuse generic hybrid SQLite helpers when their contracts truly match. It must not enlarge unrelated thread-store modules or push any tracked text file over 700 physical lines.

## Risks / Trade-offs

- [Risk] Two representations can drift after a crash. -> Canonical-first writes, hash/update-time reconciliation, and rebuild tests make SQLite disposable.
- [Risk] `better-sqlite3` or FTS5 can fail in packaged Electron/TUI builds. -> Reuse native-module diagnostics, retain filesystem fallback, and require native packaging evidence.
- [Risk] CJK token projection can enlarge the index. -> Bound generated grams per field and measure index bytes in fixtures.
- [Risk] New ranking may hide identity memories previously injected unconditionally. -> Add explicit identity/preference fixtures, type affinity, user-visible search, and retrieval traces.
- [Risk] Compatibility fields can create strict-schema downgrade failures. -> Keep canonical writes additive and test supported downgrade/rollback paths before enabling automatic rewrites.
- [Risk] Manager and local adapters can diverge. -> Run one shared port contract suite against both direct and remote stores.
- [Trade-off] JSON remains a write cost. -> Explicit memory mutation volume is low, while recoverability and native-module degradation are more important in this foundation.
- [Trade-off] Lexical retrieval cannot solve all synonym queries. -> Record the limitation in evaluation and add embeddings only in a measured follow-up.

## Migration Plan

1. Add V2 schemas, legacy normalization, pure search-token/ranking helpers, and evaluation fixtures without changing production store selection.
2. Add the hybrid memory index, schema migrations, diagnostics, backfill, and direct port contract tests.
3. Select `HybridMemoryStore` in local and Manager composition while retaining `FileMemoryStore` as the degraded implementation.
4. Replace unconditional user-memory injection, honor `maxInjectedRecords`, add context budgets, and record retrieval traces.
5. Extend existing HTTP/TUI/renderer mappings and memory settings diagnostics without changing CRUD semantics.
6. Run legacy fixture migration, index deletion/corruption, Manager restart, scope isolation, prompt safety, and packaged FTS5 checks.
7. Compare retrieval metrics with the recorded baseline and document accepted regressions or tune bounded weights before merge.

Rollback selects `FileMemoryStore` again and ignores the derived index. No rollback step deletes canonical JSON. A later cleanup of an unused index requires a separate exact-path migration after the rollback window.

## Open Questions

- Should the first implementation expose a user-facing reindex action, or keep rebuild automatic and diagnostics-only until real recovery cases justify UI?
- How long must a packaged downgrade remain supported after V2 fields begin writing: one stable release or the full current compatibility window?
- Should token budgeting use the active model tokenizer when available, or a deterministic character estimate in this foundation?

These questions affect delivery details but do not change the canonical-data, authority, scope, or degraded-operation requirements.

## References

- Kun hybrid storage: `kun/src/adapters/hybrid/hybrid-thread-store.ts`
- Kun memory implementation: `kun/src/memory/memory-store.ts`
- Kun architecture and contribution rules: `docs/kun-architecture.md`, `docs/kun-contributing.md`
- Nowledge Mem public concepts: <https://mem.nowledge.co/docs/concepts/search-architecture>, <https://mem.nowledge.co/docs/concepts/memory-decay>
