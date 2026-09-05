## Context

Kun renews a thread execution lease every five seconds against a fifteen-second TTL. Usage history currently crosses the Manager data plane as cumulative JSON snapshots, and the request path may synchronously load, parse, validate, attribute, aggregate, serialize, and parse a large global history. Renderer usage SSE events can trigger several overlapping refreshes. The same runtime event loop renews leases, so this work can manufacture `owner_lease_expired`; Manager reconciliation then races a late model response from the stale owner.

All desktop processes also stop scheduling during host sleep. On wake, Manager reconciliation, Runtime local deadlines, and Main watchdog probes can run before heartbeats recover and incorrectly treat a surviving owner as dead. The design must retain Manager as the only physical writer, preserve single-owner fail-closed behavior, keep GUI and TUI on the same runtime boundary, and leave source-checkout work untouched during the worktree build.

## Goals / Non-Goals

**Goals:**

- Keep Runtime and Manager control loops responsive while querying or recovering large usage histories.
- Reject every turn-owned mutation from a lease generation that is no longer authoritative.
- Preserve active ownership across a confirmed whole-host scheduling pause without admitting a competing owner.
- Keep public usage DTOs, pricing authority, side-thread accounting, and existing interrupted-turn recovery compatible.

**Non-Goals:**

- Raising lease TTLs to hide blocking work.
- Allowing two owners, accepting unfenced turn writes, or moving canonical writes out of Manager.
- Adding a runtime diagnostics UI, power-save blocker, or a GUI-only correctness dependency.
- Rewriting historical prices as persisted authority.

## Decisions

### Isolate expensive usage queries over the rebuildable index

Manager continues to persist cumulative usage events in the existing rebuildable SQLite index while canonical JSONL events remain recoverable. Differential folding and attribution happen inside isolated query execution instead of the control loop, avoiding a second live-write schema and migration risk.

A dedicated read-only query worker opens the same SQLite database and executes scanning, JSON fallback, timezone grouping, and the existing pure response builders. Manager remains the only writer. Runtime receives the already-aggregated public DTO instead of a list of every usage record. Identical queries are single-flight and cached by the persisted usage high-water generation. Query work has a bounded deadline and never falls back to synchronous replay on a control loop.

Background recovery continues to stream JSONL into the cumulative index in bounded chunks with a resumable high-water mark. Legacy attribution can read thread metadata without loading messages; request-time full-thread hydration is forbidden. Unrecoverable attribution is `unknown` rather than a guess based on current thread settings.

Alternatives rejected: merely memoizing hydrated threads retains large serialization and parse costs; moving the whole Manager into a worker weakens its control-plane simplicity; precomputing prices makes catalog corrections impossible.

### Refresh persisted usage only at stable UI boundaries

The live SSE snapshot remains the source for current-turn counters and timing. A persisted usage refresh key advances once at terminal settlement, not for every model-step usage event or busy-state transition. Hooks share an in-flight/last-success cache, and hidden right-panel usage content remains mounted with `enabled=false` so it preserves UI state without issuing work.

### Fence turn-owned mutations at Manager commit

Every acquired thread lease receives a durable monotonic `fencingToken`; renew keeps it and reacquire allocates a larger value. A `TurnMutationFence` captured at admission is passed explicitly through turn-owned persistence and the Manager request envelope. Manager validates it before queuing and again immediately before the physical write. The internal expired-lease reconciler is privileged and idempotent.

The Manager protocol version is advanced as a breaking fencing boundary. A new Runtime refuses an older Manager connection rather than silently downgrading. Legacy state is migrated by assigning durable high-water values before accepting new work.

Alternatives rejected: abort signals alone cannot stop an already-resolved model promise; validating only at enqueue leaves a queue race; a process-global current lease can attach the wrong fence to concurrent turns.

### Treat whole-host pause separately from a Runtime-only stall

Electron Main reports suspend/resume to an authenticated internal Manager endpoint, but Manager also detects a large gap in its own one-second reconciliation clock before expiring anything. This fallback covers headless/TUI operation and missed Electron notifications.

Manager tracks an idempotent `suspended -> recovering -> active` generation. During suspend and the twenty-second recovery grace, existing runtime slots, thread leases, resource leases, and fencing tokens remain reserved; competing acquisition stays busy. The original owner can renew the same token. When grace expires, unrecovered owners follow the existing expiration and reconciliation path exactly once.

Runtime local lease deadlines recognize a long scheduling gap, grant a bounded renewal window, and immediately revalidate the same fence. Manager remains the commit authority throughout; explicit loss aborts the old execution and stale writes are rejected. Main's watchdog pauses failure accounting and restart attempts while the host generation is suspended or recovering.

Alternatives rejected: extending every TTL permanently delays real crash recovery; relying only on `powerMonitor` fails when no GUI is running; treating any Runtime-only lag as host sleep would weaken fencing.

## Risks / Trade-offs

- [SQLite worker lifecycle adds complexity] -> Keep cumulative events canonical, reuse the rebuildable index, and make worker failure a bounded temporary error.
- [Worker failure makes usage temporarily unavailable] -> Return a structured timeout/unavailable response and retain the Renderer's last successful result; never block lease control loops.
- [Protocol rollout encounters an old Manager] -> Fail turn admission with a concrete protocol mismatch while keeping read-only operations available.
- [Duplicate or missed power events] -> Make generations idempotent and use Manager clock-gap detection as the correctness fallback.
- [A required change overlaps dirty source files at integration] -> Rebase and resolve committed conflicts in the worktree; never stash/reset source changes, and clean up only after ancestry proof.

## Migration Plan

1. Migrate Manager snapshots to thread-fence high-water and host-liveness state before serving turn admission.
2. Keep the existing cumulative usage index/backfill and route usage folding through an isolated read-only worker.
3. Route usage HTTP queries through the worker; keep public DTO validation at the existing boundary.
4. Advance the Manager protocol boundary and require fenced turn mutations on all compatible connections.
5. Wire Main power notifications and watchdog gates; retain Manager clock-gap fallback for non-GUI clients.
6. Rollback leaves the existing usage index intact, but a Runtime that emitted fenced mutations must not run against an older Manager without a full coordinated restart.

## Open Questions

None. Thresholds use existing cadence: five-second renewals, fifteen-second thread lease TTL, twenty-second runtime heartbeat TTL/recovery grace, and one-second Manager reconciliation.
