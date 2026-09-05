## 1. Recovery coordination and cancellation

- [x] 1.1 Add a per-thread recovery coordinator with join, cancellation, foreground activity, per-thread backoff, and diagnostics
- [x] 1.2 Thread cancellable prioritized timeline requests through provider, renderer client, preload, Main IPC, and Runtime fetch
- [x] 1.3 Convert active recovery to snapshot/state-first SSE reconciliation with forced timeline fallback on replay reset
- [x] 1.4 Add regression tests proving concurrent triggers share one physical read and obsolete hydration is aborted

## 2. Prewarm and presentation

- [x] 2.1 Add dwell delay, cancellation, a four-thread queue bound, and foreground/overload pause to sidebar prewarm
- [x] 2.2 Keep trusted snapshot content visible with a compact catch-up state while retaining composer admission gating
- [x] 2.3 Add focused prewarm and hydration-presentation tests

## 3. Live checkpoint hot path

- [x] 3.1 Coalesce live checkpoints before the thread write lane using byte, event-count, and time thresholds
- [x] 3.2 Force pending checkpoint flushes on terminal item, thread reset, and store shutdown without advancing revision on skipped writes
- [x] 3.3 Add checkpoint lag, single-flight flush, recovery, and shutdown tests

## 4. Indexed persisted replay

- [x] 4.1 Add validated rebuildable sparse event sequence/byte-offset sidecars and append/invalidation integration
- [x] 4.2 Seek initial event pages and SSE replay through the sparse index with authoritative JSONL fallback
- [x] 4.3 Add index corruption, stale identity, retention replacement, and tail-read regression tests

## 5. Read admission and overload

- [x] 5.1 Add foreground/background timeline read coalescing, bounded admission, and retryable 503 responses
- [x] 5.2 Preserve retryable overload through Main and renderer recovery without treating it as Runtime process failure
- [x] 5.3 Add identical-read, queue saturation, and foreground-priority tests

## 6. Resumable maintenance

- [x] 6.1 Add a persisted single-lane maintenance coordinator with bounded slices, cooldown, and foreground/active-turn pause
- [x] 6.2 Convert attachment reference discovery to complete resumable generations before pruning
- [x] 6.3 Convert automatic guardian work to resumable quick slices while keeping explicit deep diagnostics available
- [x] 6.4 Add restart-resume, partial-generation safety, pause, and slice-duration tests

## 7. Runtime supervision and observability

- [x] 7.1 Add consecutive-failure restart admission and restart cooldown that pauses optional background work
- [x] 7.2 Expose content-free recovery, replay, checkpoint, maintenance, overload, and restart metrics
- [x] 7.3 Add a deterministic large-profile recovery stress fixture covering duplicate recovery and background contention

## 8. Validation

- [x] 8.1 Run focused renderer, Main IPC, Runtime storage, replay, maintenance, and supervision tests
- [x] 8.2 Run typecheck, Kun build, application build, lint/file-size gates, and classify unrelated baseline failures
- [x] 8.3 Record measured request coalescing, replay seek, checkpoint lag, maintenance bounds, and restart behavior in the change artifacts
