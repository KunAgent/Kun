## Why

Kun already supports explicit long-term memory, but the current file store scans every JSON record for list and retrieval operations, unconditionally injects active user-scope records, and folds age decay into confidence. This works for a small manual profile but does not provide the bounded retrieval, provenance, recovery, or evaluation foundation needed for safe automatic memory in later changes.

The latest `develop` branch already establishes a stronger local-storage pattern for threads: filesystem records remain canonical while SQLite is a rebuildable index with explicit degraded behavior. Memory should follow that architecture instead of introducing a second runtime or a separately operated memory service.

## What Changes

- Extend the memory contract with additive, backward-compatible type, authority, importance, observation-time, validity, and bounded source-evidence fields.
- Keep atomic per-record JSON files canonical and add a Manager-owned SQLite/FTS5 index that can be rebuilt from them.
- Index normalized Latin tokens and CJK n-grams so lexical retrieval remains useful across the languages Kun currently supports.
- Replace unconditional user-memory injection with scope-filtered, relevance-ranked, configured, token-bounded retrieval.
- Separate confidence from time-derived freshness and preserve importance as an independent ranking signal.
- Mark injected memories as untrusted reference context and retain a bounded retrieval trace for diagnostics.
- Add deterministic retrieval evaluation fixtures covering scope isolation, CJK, synonyms, freshness, replacement, prompt injection, and damaged or missing indexes.
- Preserve current memory CRUD, import/export, HTTP, TUI, Manager remote-store, and settings behavior while extending diagnostics for index state and retrieval.

## Capabilities

### New Capabilities

- `memory-record-foundation`: Versioned memory records, bounded source evidence, authority, canonical persistence, rebuildable indexing, migration, and degraded operation.
- `memory-retrieval-foundation`: Scope-safe lexical retrieval, independent ranking signals, bounded reference-context assembly, retrieval diagnostics, and repeatable evaluation.

### Modified Capabilities

None.

## Impact

- Extends `kun/src/contracts/memory.ts`, the memory port, file-backed implementation, Manager shared-store operations, runtime composition, memory routes, and renderer/TUI mappings.
- Adds focused hybrid-memory adapter modules backed by the existing `better-sqlite3` runtime dependency; it adds no new external service or runtime.
- Changes turn memory selection and prompt framing while retaining existing explicit memory tools and user controls.
- Adds compatibility parsing and index backfill for existing `<dataDir>/memory/*.json` records without eagerly rewriting or deleting them.
- Updates Kun architecture and memory documentation, including attribution for the public Nowledge Mem concepts used as design references.

## Delivery Boundary

This change establishes only the storage and lexical retrieval foundation. Automatic Triage/Distillation, embedding retrieval, EVOLVES relationships, semantic entity graphs, Working Memory, communities, and Crystal generation require separate follow-up changes after this foundation is measured and accepted.
