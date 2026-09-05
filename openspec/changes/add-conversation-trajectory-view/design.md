## Context

Kun currently records exact model transports through `LlmDebugRecorder`, persists completed records in per-thread JSONL, and renders them in the workbench Agent Perspective right panel. Canonical conversation text, reasoning, tool calls/results, compaction items, usage events, and attachments already live in the Session store and arrive through the existing thread timeline/SSE path. Persisting full request history and raw responses again in the trace JSONL scales poorly for long conversations.

The trajectory must remain a single-Kun-runtime feature, work across supported model transports, survive restart, preserve cache/prompt behavior, and avoid adding full payloads to the public runtime event stream. Existing schema-v1 trace files and capture settings must remain readable.

## Goals / Non-Goals

**Goals:**

- Make compact request lifecycle metadata available for every conversation regardless of full-content capture.
- Correlate Provider attempts, logical model steps, Session items, and tool lifecycles with stable IDs.
- Reconstruct optional prompt detail through manifests and deduplicated compressed blobs without copying response/tool/attachment bodies.
- Expose bounded trajectory page, summary, and detail APIs with a filesystem-authoritative fallback.
- Replace the right-panel Agent Perspective entry with a center conversation view while retaining its semantic request parsing and detail capabilities.
- Keep the chat timeline and composer mounted, and provide a scalable chronological trajectory UI.

**Non-Goals:**

- Persisting token/chunk-level deltas, raw HTTP exchanges, attachment bytes, or complete tool outputs in trajectory storage.
- Prompt diff, trace export, timeline zoom/range selection, request comparison, pinned detail retention, or a complete subagent tree.
- Making SQLite the authoritative store or adding another agent/runtime path.

## Decisions

### Separate compact lifecycle retention from optional content retention

The model observer always creates a logical round and one record per actual transport attempt. A record receives stable `roundId`, `requestId`, `turnId`, `step`, and `attempt` values and is checkpointed at start, first content, and terminal state. The existing thread capture flag controls prompt-manifest/blob creation and bounded in-memory wire diagnostics only; it never suppresses metadata.

This replaces the current all-or-nothing recorder policy. It preserves useful timing/error/usage information while keeping sensitive prompt capture explicit.

### Treat Session items as the response and tool source of truth

Assistant text/reasoning, tool arguments/results, compaction, user messages, and attachments are referenced by stable item/call IDs. Trajectory records store only associations and bounded previews. The model request receives an internal trace context so items produced by the round can retain `roundId`, `requestId`, and `step` when applicable.

Copying these bodies into trajectory storage was rejected because it duplicates the largest data in long sessions and creates inconsistent deletion/compaction behavior.

### Use immutable content-addressed files for optional prompt detail

A prompt manifest stores the ordered request structure, Session boundary, item references, content hashes, and attachment metadata. Sanitized System Prompt, tool catalogs, request options, and fallback message fragments are hashed with SHA-256 and stored once as Brotli-compressed files. Blob files are private, immutable, and capped; over-limit content retains bounded head/tail data and explicit truncation metadata.

Node Brotli is chosen instead of a new Zstd native dependency so packaged Kun and standalone TUI use the same built-in codec. The manifest records the codec for future extensibility.

### Keep filesystem data authoritative and indexes rebuildable

Per-thread compact journals, manifests, and blob files are authoritative. Hybrid SQLite may index request/tool metadata, previews, and blob references for summary/filter/search, but the index can be rebuilt and the APIs fall back to journal scans if SQLite is unavailable. Blob garbage collection uses mark-and-sweep over authoritative manifests instead of trusting a mutable reference count after crashes.

### Expose a trajectory-specific query contract

`GET /v1/threads/{id}/trajectory` returns a versioned, newest-first page with an opaque cursor and optional filter/query. `summary` is a lightweight aggregate suitable for the closed-view button. Record `detail` resolves only the requested section from manifests and Session references. The renderer reverses loaded pages into chronological ledger order and prepends older pages without changing stable selection.

The existing model-request route remains as a compatibility projection for schema-v1 clients and legacy records.

### Preserve the conversation shell across center-view switches

The chat timeline stays mounted but hidden while trajectory is active, and the composer remains mounted below either center view. Per-thread trajectory UI state is held in a bounded Zustand store. The old right-panel contribution is removed; stored legacy IDs normalize to no panel.

The trajectory implementation reuses and splits Agent Perspective semantic parsing/detail primitives rather than extending files already near the repository line limit. Variable-height ledger rows use `@tanstack/react-virtual`.

## Risks / Trade-offs

- [A manifest item reference may be pruned later] → Store a sanitized content hash/fallback blob for exact captured input and surface missing/evicted detail explicitly.
- [Always-on metadata adds writes] → Persist only lifecycle transitions plus a maximum one lightweight checkpoint every two seconds; never persist deltas.
- [A crash can leave pending records] → On startup/query, terminalize inactive pending records as `interrupted` and expire checkpoints after 24 hours.
- [Blob budgets can remove requested detail] → Never evict lifecycle metadata; return `evicted` while preserving timing, usage, errors, and Session references.
- [Legacy raw traces are large] → Stop new durable raw writes, normalize legacy records on read, and let existing retention/thread deletion remove them without destructive migration.
- [Search can duplicate content] → Index only metadata and a 2 KiB sanitized preview; do not build a full-text copy of blobs.
- [SQLite/native binding failure] → Keep journals authoritative and test the scan fallback.

## Migration Plan

1. Introduce new contracts and a compatibility reader for existing schema-v1 records.
2. Start writing compact lifecycle records and optional manifests while leaving legacy files untouched.
3. Add query APIs and renderer clients, then switch the workbench entry to the center trajectory view.
4. Stop durable raw payload appends; keep bounded live diagnostics for explicit capture.
5. Delete both legacy and new trajectory artifacts when a thread is deleted and run best-effort blob GC.
6. Rollback remains possible because Session data is unchanged and legacy settings/records remain parseable.

## Open Questions

None. Storage limits, capture policy, UI placement, and first-version scope are fixed by the approved plan.
