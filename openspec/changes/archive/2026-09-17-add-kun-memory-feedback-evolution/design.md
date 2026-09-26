## Context

See `proposal.md` for motivation. Canonical Memory V2 records live as one JSON file per record; SQLite/FTS5 is rebuildable. `MemoryRetrievalTrace` currently retains only the latest decision, and `setLastInjected()` updates diagnostics synchronously. Actual Memory context is assembled in the main agent loop, Cursor SDK runtime, and Agent SDK runtime. Manager owns shared production stores when present.

The design must add durable feedback without turning retrieval frequency into truth, rewriting Memory timestamps on every turn, creating another Memory authority source, or allowing feedback failure to break a model turn.

## Goals / Non-Goals

**Goals:**

- Persist strict, private, idempotent retrieval/confirmation/correction events through one owner.
- Rebuild per-Memory usage aggregates without mutating Memory records.
- Add explicit confirmation and versioned correction across local, Manager, HTTP, and UI paths.
- Preserve byte-for-byte retrieval/context parity when collection is disabled or degraded.
- Evaluate bounded feedback features offline before any production ranking change.

**Non-Goals:**

- Enabling feedback-aware production ranking in this change.
- Inferring confirmation from model behavior, repeated retrieval, dwell time, or absence of correction.
- Storing queries, prompts, Memory bodies, model outputs, source excerpts, or machine paths in feedback.
- Adding embeddings, vector storage, a remote telemetry service, knowledge-graph relations, or Working Memory summaries.
- Replacing ordinary metadata editing; only an explicit correction action gets versioned correction semantics.

## Decisions

### 1. Keep feedback as a separate append-only authority for events

Store versioned feedback events below the existing data root, separate from `<dataDir>/memory/*.json`. The ledger is authoritative only for feedback history; Memory JSON remains authoritative for facts, lifecycle, scope, evidence, and version links. A rebuildable aggregate projection provides counts and last-event timestamps.

Writing aggregate fields into each Memory JSON was rejected because retrieval would rewrite canonical records, alter `updatedAt`/freshness semantics, amplify disk writes, and create a popularity feedback loop in otherwise stable ranking.

### 2. Use stable event identities and one serialized owner

Every event has a caller-stable id. Same-id/same-payload replay is a no-op; same-id/different-payload replay is rejected. Manager owns the production ledger and aggregate projection, with direct local composition implementing the same contract. Remote clients use shared-data RPC rather than private ledgers.

The ledger reader accepts only complete, schema-valid events. A malformed final line is excluded and diagnosed; malformed interior data fails the affected rebuild rather than silently changing counts. Writes use the existing mutation-queue/atomic-file conventions and bounded diagnostics.

### 3. Add an explicit asynchronous injection-recording boundary

Do not persist usage in `MemoryStore.retrieve()` because list/search/evaluator callers can retrieve without injecting. Do not overload synchronous `setLastInjected()` with I/O; retain it for latest diagnostics compatibility.

After final prompt budgeting and Memory block construction, each runtime calls one shared asynchronous `recordRetrieved()` helper with selected ids plus stable thread/turn identity. It records an impression meaning “included in model context”, never “read”, “used”, or “confirmed”. Best-effort append failures update bounded feedback diagnostics and do not fail the turn.

### 4. Require explicit actions for confirmation and correction

Confirmation is a dedicated operation on an authorized active Memory. Correction is not generic update: it accepts the old id, corrected Memory fields, scope access, and a stable operation id. The settings UI labels these actions explicitly; model output cannot invoke them as user confirmation.

Correction uses the existing Memory mutation queue and deterministic create-with-id/supersedes behavior. A small durable apply receipt bridges the canonical mutation and feedback append. Restart reconciliation checks whether the new record and old `supersededAt` already match, then appends or recognizes the correction event exactly once. This mirrors the proven distillation receipt pattern instead of attempting a cross-file transaction. A receipt whose prior record was purged or can otherwise never be corrected again moves to a terminal `abandoned` state instead of warning on every startup; unreadable receipts are quarantined as `*.corrupt`, and terminal receipts are pruned to a bounded tail so the directory cannot grow without limit.

### 5. Make collection opt-in and ranking-independent

Add `memory.feedback.enabled`, defaulting to `false`. The runtime capability surface reports collection availability and bounded degradation, but retrieval does not read aggregate usage. Disabling collection stops new retrieval/confirmation events; historical feedback remains local and auditable. Explicit correction remains a Memory mutation and is available only through its own operation contract.

A shadow-only offline evaluator consumes anonymous Memory and feedback fixtures. It compares the unchanged lexical baseline with pre-registered feedback formulas, including `log1p(retrievalCount)` and separate confirmation/correction features. Candidate traces list every feature independently. A go result only permits a later P3-B proposal; it does not enable a weight or hidden feature flag.

### 6. Bound data growth without erasing explicit audit evidence

Ledger configuration declares segment and total-byte ceilings. Once a segment reaches its bound, Kun writes a versioned aggregate checkpoint before removing covered segments. The checkpoint retains each compacted event's id and payload hash so same-payload replay remains a no-op and same-id/different-payload replay still fails closed; explicit confirmation/correction events remain in full for audit. Recovery ignores segments covered by the last valid checkpoint, which makes interruption before or after segment removal equivalent. If the checkpoint receipts plus later segments reach the hard total ceiling, feedback persistence degrades and stops accepting new events rather than deleting identity or explicit audit evidence; core Memory behavior remains available. The operator recovery path — back up `memory-feedback/`, then raise the byte ceilings or reset the directory — is documented in `docs/memory-foundation.md`.

Unbounded JSONL and per-turn canonical Memory rewrites were rejected. Fixed time-based deletion of all events was also rejected because it could erase correction audit history.

## Risks / Trade-offs

- **Cross-file correction can stop between canonical mutation and feedback append** → persist a stable receipt first and reconcile idempotently on startup/retry.
- **Three runtime surfaces can drift** → expose one shared context-assembly recording helper and contract tests for main, Cursor SDK, and Agent SDK paths.
- **Retrieval frequency can self-reinforce** → production ranking never reads feedback in this change; offline frequency is log-scaled, bounded, and reported separately from confirmation.
- **Feedback history can reveal behavior patterns** → store ids/timestamps only, omit query/content/path data, bound diagnostics, and keep collection opt-in/local.
- **Ledger growth can become unbounded** → segment and checkpoint events, compact retrieval payloads into exact identity receipts plus aggregates, and stop feedback collection at the hard capacity instead of deleting explicit audit evidence.
- **Disabled/degraded paths can accidentally alter output timing or results** → require result, order, trace, context, and turn-outcome parity tests with failing ledger adapters.

## Migration Plan

1. Add contracts and readers with feedback disabled by default; existing installations have no ledger and require no Memory migration.
2. Add ledger, projection, Manager parity, and diagnostics. Missing feedback data represents zero observations, not an error.
3. Add runtime recording and explicit UI/API operations behind the opt-in collection setting.
4. Run anonymous offline evaluation and record go/no-go. Keep production ranking unchanged regardless of this change's merge.
5. Rollback by disabling collection and removing the rebuildable aggregate projection. Preserve the append-only ledger and canonical Memory versions for audit; old binaries continue to ignore them.
