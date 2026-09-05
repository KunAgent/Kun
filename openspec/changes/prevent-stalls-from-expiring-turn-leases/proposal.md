## Why

Long-running conversations can repeatedly execute expensive usage-history queries on the same event loop that renews turn ownership. When that loop is starved, or the whole host resumes from sleep, the 15-second owner lease can expire even though the turn is still alive; the old execution may then persist a late assistant response after Manager reconciliation has already failed the turn.

## What Changes

- Move usage-history scanning and aggregation off Runtime and Manager request loops, using the existing rebuildable usage index and bounded background recovery.
- Coalesce Renderer usage refreshes so active turns use SSE telemetry and persisted history refreshes once after settlement; hidden usage panels stop issuing requests.
- Add monotonic fencing tokens to thread execution leases and require turn-owned mutations to present the current fence at commit time.
- Make Manager, Runtime, and Electron watchdog behavior aware of host suspend/resume without weakening single-owner or fail-closed semantics.
- Preserve all existing public `/v1/usage` response shapes, pricing semantics, and side-thread accounting.

## Capabilities

### New Capabilities

- `nonblocking-usage-aggregation`: Usage indexing, recovery, query isolation, request coalescing, and stable public usage responses.
- `fenced-turn-lease-mutations`: Monotonic turn-lease fences and stale-writer rejection across Manager-owned thread/session persistence.
- `host-suspend-safe-runtime-liveness`: Suspend/resume coordination, recovery grace, local lease revalidation, and watchdog suppression.

### Modified Capabilities

None.

## Impact

- Kun Manager state, internal HTTP protocol, remote data stores, turn admission/persistence, usage adapters/services, and runtime heartbeat handling.
- Electron Main power lifecycle and runtime supervisor; no new renderer/preload API or diagnostics surface.
- Renderer usage hooks and right-panel activation behavior.
- Usage-index query/backfill compatibility and migration for existing Manager snapshots.
