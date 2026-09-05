## Why

Large local profiles can enter a self-amplifying recovery loop: overlapping timeline reads and file-head event replay saturate the Service Manager, restart-triggered maintenance adds more full-profile work, and the renderer hides an already usable snapshot while waiting for SSE synchronization. The observed 2,073-thread, 4.2 GB profile produced hundreds of duplicate timeline requests and repeated Runtime restarts, so recovery must become bounded by construction instead of relying on longer timeouts.

## What Changes

- Coordinate timeline hydration, SSE recovery, manual retry, watchdog recovery, and prewarming so one thread has at most one physical foreground recovery request.
- Add cancellable runtime requests and foreground/background priority so stale hydration and queued prewarm work stop consuming Main, Runtime, Manager, and filesystem resources.
- Reuse trusted renderer snapshots and lightweight thread state before falling back to a full timeline read; keep trusted content visible while catch-up disables mutation.
- Coalesce live checkpoints outside the per-thread write lane and flush on bounded byte, event, or time lag.
- Add a rebuildable sparse event sequence/byte-offset index and use it for persisted SSE replay without changing `events.jsonl` authority.
- Replace restart-relative full-profile maintenance spikes with resumable, time-bounded slices that pause for foreground recovery and active turns.
- Add overload admission, retryable 503 behavior, restart backoff/safe-mode hooks, telemetry, and large-profile regression coverage.

## Capabilities

### New Capabilities

- `large-profile-thread-recovery`: Defines bounded, cancellable, snapshot-first thread recovery, indexed event replay, resumable maintenance, and graceful overload behavior for large local profiles.

### Modified Capabilities

None.

## Impact

- Renderer thread stores, prewarm coordination, timeline presentation, and runtime provider contracts.
- Preload/Main runtime-request IPC and managed Runtime supervision.
- Kun thread state/timeline/SSE routes, file-session live checkpoints and event history, Manager-backed reads, maintenance scheduling, and diagnostics.
- New rebuildable sidecar/state files under each thread or Runtime data directory; canonical message and event JSONL formats remain authoritative and rollback-safe.
