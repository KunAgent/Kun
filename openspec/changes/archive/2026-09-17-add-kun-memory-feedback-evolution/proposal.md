## Why

Kun can retrieve, approve, disable, and supersede Memory records, but it does not persist whether a record was merely injected, explicitly confirmed, or corrected. Without a privacy-bounded and auditable feedback history, retrieval frequency can be mistaken for truth and feedback-aware ranking cannot be evaluated safely.

## What Changes

- Add an append-only, idempotent Memory feedback ledger that records retrieval impressions separately from explicit confirmation and correction, without storing query text, Memory bodies, local paths, credentials, or model output.
- Add a rebuildable aggregate usage view with retrieval, confirmation, and correction counts/timestamps; do not write usage into canonical Memory records or change `updatedAt`/freshness during retrieval.
- Record retrieval feedback only for records actually assembled into turn context, not for GUI search, diagnostics, or candidate retrieval.
- Add explicit confirmation and versioned correction operations across local, Manager, HTTP, and settings UI paths. A correction creates a new Memory with `supersedes` and retains the old record for audit instead of overwriting its content.
- Add anonymous deterministic fixtures and an offline feedback-ranking candidate using bounded/log-scaled signals. This change evaluates the candidate but does not enable feedback in production ranking.
- Keep feedback collection opt-in and fail-open for core retrieval: disabled, unavailable, corrupt, or failed feedback persistence cannot change selected ids, ordering, context text, or turn completion.

## Capabilities

### New Capabilities

- `memory-feedback-evolution`: Defines feedback event identity, privacy, persistence, aggregation, explicit confirmation/correction, runtime capture boundaries, diagnostics, and offline go/no-go evaluation.

### Modified Capabilities

- `memory-record-foundation`: Defines correction as an atomic versioned supersession while preserving canonical record authority, audit history, and projection convergence.
- `memory-retrieval-foundation`: Defines actual-injection feedback capture, disabled/failure parity, and the prohibition on enabling feedback-aware production ranking without a separate passed decision gate.

## Impact

- Memory contracts, canonical mutation flow, a new feedback ledger/aggregate adapter, file/hybrid/Manager store parity, and Manager shared-data RPC contracts.
- Main agent-loop, Cursor SDK, and Agent SDK turn-context assembly must use one explicit asynchronous injection-recording boundary.
- Memory HTTP routes, preload/Main adapters, and settings UI receive explicit confirm/correct operations; generic search and diagnostics do not emit retrieval feedback.
- New anonymous feedback fixtures, evaluator, traces, and tests; no embedding model, vector index, network dependency, or production ranking-weight change.
