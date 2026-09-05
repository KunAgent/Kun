## Context

The desktop renderer hydrates a bounded timeline and then waits for an SSE replay barrier before revealing a running conversation. Recovery can be triggered by selection, stream termination, watchdogs, restart reconciliation, sends, and a manual button. Generation fencing prevents stale commits but does not stop duplicate physical HTTP requests. The persistent Runtime uses append-only JSONL through a Service Manager; live model deltas are emitted at a 40 ms cadence, the initial live checkpoint can remain unchanged until 64 KiB of additional text, and reconnect paging can repeatedly scan `events.jsonl` from byte zero. Runtime-relative attachment and guardian timers can also restart full-profile work after every process replacement.

The production profile that motivated this change contains 2,073 thread directories and about 4.2 GB of thread data. The design must retain canonical JSONL authority, cross-process fencing, bounded memory, rollback compatibility, and the existing HTTP/SSE protocol semantics.

## Goals / Non-Goals

**Goals:**

- Guarantee one physical foreground recovery flight per thread and cancel obsolete timeline reads across Renderer, preload, Main, and Runtime fetch.
- Prefer a trusted local projection plus lightweight state/SSE reconciliation over repeatedly loading a full timeline.
- Bound live-checkpoint age and event lag without entering the thread write lane for every provider delta.
- Seek persisted replay near `sinceSeq` through a rebuildable sparse sidecar while preserving JSONL as the source of truth.
- Make prewarm and maintenance low-priority, bounded, pausable, and restart-resumable.
- Keep trusted content visible during catch-up and preserve mutation gating until synchronization.
- Degrade on overload with retryable responses/backoff instead of creating restart and retry storms.

**Non-Goals:**

- Replacing `events.jsonl` with segmented storage.
- Deleting or rewriting user history during upgrade.
- Keeping an SSE connection open for every background thread.
- Restoring legacy Runtime diagnostics or alternate agent runtimes.

## Decisions

### Coordinate recovery in the renderer

A process-local `ThreadRecoveryCoordinator` owns per-thread flights, abort controllers, attempt state, foreground activity, and counters. Equivalent callers join one Promise. A changed thread selection or explicit invalidation aborts the old request. Backoff is retained per thread and resets only on a replay barrier, a new sequence, or a terminal state.

The current Zustand action remains the public entry point so existing callers do not gain independent recovery state. The action delegates its physical work to the coordinator. Replay-reset recovery forces a new timeline; ordinary disconnect/watchdog recovery first probes lightweight state and resumes SSE from the trusted projection cursor.

Alternative: generation fencing alone. It protects state correctness but leaves all superseded I/O running and caused the observed request storm.

### Carry cancellation through a request ID

`getThreadDetail` accepts `signal` and priority. `RendererRuntimeClient` assigns a request ID only for cancellable calls. The preload exposes a narrow cancel operation; Main maps `(WebContents, requestId)` to an AbortController and passes its signal to the existing Runtime HTTP client. Destroyed renderers cancel all owned requests.

Alternative: rely on the fixed timeline timeout. A 120-second abandoned read is too expensive and makes rapid selection unsafe under load.

### Reveal trusted snapshots while retaining the mutation gate

Cold hydration with no trusted blocks keeps the full-area loading state. A restored snapshot renders immediately, with a compact catch-up status layered above it. `threadLoadingId` continues to disable composer mutations until the ordered replay barrier arrives. Markdown paint readiness is not treated as network hydration.

### Coalesce live checkpoints before the write lane

The file session store retains one pending checkpoint per live item. The first checkpoint is written synchronously. Later calls only replace the in-memory latest item and increment counters; they enter the thread write lane when any of these bounds is reached: 64 KiB of new text, 128 durable delta events, one second since the last durable checkpoint, terminal staging, or shutdown. A single timer/flush is allowed per item and dirty data arriving during a flush is retained for the next flush.

Alternative: only increase the model delta coalescer delay. This reduces event count but does not bound recovery lag or eliminate unnecessary lock/revision churn.

### Add a sparse, rebuildable event offset index

Each thread can have `events-index.bin` plus `events-index.state.json`. Binary entries are fixed-width little-endian `(uint64 seq, uint64 byteOffset)` pairs. An entry is recorded at least every 256 events or 1 MiB of appended data. State records file identity, indexed bytes, and the latest indexed sequence. Readers validate inode/device/size, binary-search the greatest sequence not newer than `sinceSeq`, and scan forward from that offset.

JSONL append happens before sidecar update. Missing, stale, corrupt, truncated, or mismatched indexes fall back to byte zero and schedule a bounded rebuild. Event retention replacement invalidates the sidecar. The sidecar is never required for correctness.

### Admit foreground and background timeline reads separately

A Runtime `ThreadReadCoordinator` joins identical in-flight reads, caps foreground concurrency at two and background concurrency at one, and bounds queued work. Background work yields to foreground work. Queue overflow returns HTTP 503 with `Retry-After`; the renderer treats it as recoverable overload and backs off without asking the supervisor to restart.

### Slice maintenance and persist progress

One `MaintenanceCoordinator` runs low-priority slices. A slice stops after 50 ms or eight threads, checks for active turns/foreground reads, and persists its cursor. Attachment cleanup accumulates one complete reference generation before pruning and requires a second completed generation plus the existing age grace before deletion. Automatic guardian work uses quick checks; deep verification remains explicit.

Maintenance state is rebuildable and versioned. Runtime restart resumes a partial generation rather than returning to thread zero. A restart/overload cooldown pauses maintenance and prewarm.

### Prefer degradation over restart

Liveness remains storage-independent. Read admission and maintenance expose overload locally; repeated recovery joins use jittered backoff. Main keeps the existing process health boundary but requires consecutive failed probes and applies a restart cooldown. During cooldown, background prewarm and maintenance stay paused while state, active timeline recovery, and SSE remain available.

## Risks / Trade-offs

- [A delayed checkpoint loses the latest in-memory aggregate on a hard kill] → Every emitted delta remains durable and replayable after the prior checkpoint; terminal/shutdown paths force a flush.
- [A corrupt offset seeks into the middle of a record] → Validate identity and offset, discard the partial first line when needed, and fall back to byte zero on any invariant failure.
- [Joining reads shares a result across clients with different authority] → Keys include thread, cursor/limit, and priority only after authentication; the response contains no caller-specific data.
- [Snapshot-first recovery can trust an expired cursor] → Lightweight state/replay-floor validation and `replay_reset_required` force one timeline replacement.
- [Incremental attachment scans could delete a still-referenced attachment] → Pruning only consumes a complete generation and requires a second-generation orphan confirmation.
- [Additional sidecars increase disk usage] → Indexes are sparse, rebuildable, excluded from canonical migration, and removable without data loss.
- [A compact catch-up status permits reading stale content] → Content is explicitly marked as synchronizing and all mutations remain disabled until the replay barrier.

## Migration Plan

1. Ship optional cancellation and state fields so mixed renderer/main/runtime pairs continue using the old calls.
2. Create event and maintenance sidecars lazily; do not scan all histories at startup.
3. Existing threads replay correctly without an index and gain index entries during append/read repair.
4. Existing maintenance starts a new reference generation and does not prune until that generation is complete.
5. Rollback ignores the sidecars and continues reading authoritative JSONL.

## Open Questions

None for this implementation. Segmented event storage remains a separate follow-up after indexed replay metrics are available.

## Validation Results

- Renderer/Main focused suite: 10 files and 98 tests passed; an additional final smoke subset passed 4 files and 23 tests.
- Kun storage/recovery suite: 10 files and 68 tests passed; the final post-review subset passed 9 files and 57 tests.
- Recovery stress fixture: 20 concurrent requests joined one physical foreground read (`started=1`, `joined=19`, `rejected=0`).
- Maintenance stress fixture: foreground recovery paused all background processing; two complete 200-thread generations processed exactly 400 records and invoked pruning once.
- Checkpoint fixtures verified durable advancement at 128 events and one second, plus forced shutdown flush.
- Event-index fixtures replayed only sequences 591-600 from an indexed 600-event file when starting at sequence 590; corrupt state fell back to byte zero without changing `events.jsonl`.
- `npm run typecheck`, `npm run build`, changed-file ESLint, `git diff --check`, and the 700-line source gate passed. Full repository lint still reports the pre-existing `no-control-regex` error in `BackgroundShellOverlay.tsx` plus existing hook warnings; no changed file has an ESLint finding.
- The live 4.2 GB user profile was not mutated for a destructive soak. Its workload shape is represented by deterministic duplicate-read and 200-thread sliced-maintenance fixtures; a packaged non-destructive 2,000-thread soak remains suitable release validation.
