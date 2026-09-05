## 1. Usage persistence and query isolation

- [x] 1.1 Reuse the cumulative usage index and resumable backfill, and fold differential counters inside isolated query execution.
- [x] 1.2 Add a bounded Manager usage-query operation that returns aggregated public DTOs without full-thread hydration or full-history transport.
- [x] 1.3 Move SQLite/JSONL query work off control event loops, add generation-keyed single-flight caching, and return structured timeouts.
- [x] 1.4 Cover usage recovery, attribution fallback, query isolation, and large-history responsiveness with tests.

## 2. Renderer request lifecycle

- [x] 2.1 Separate live SSE usage updates from once-per-terminal persisted-history invalidation.
- [x] 2.2 Share/coalesce usage requests and retain last-success state across bounded failures.
- [x] 2.3 Disable all usage requests while the visited right-panel tab is hidden and restore them on activation.
- [x] 2.4 Add hook and reducer tests for multi-step turns, request coalescing, and hidden-panel activation behavior.

## 3. Turn lease fencing

- [x] 3.1 Add durable monotonic thread fencing tokens and migrate legacy Manager snapshots.
- [x] 3.2 Carry an explicit turn mutation fence through admission and all turn-owned Manager persistence requests.
- [x] 3.3 Validate fences before enqueue and immediately before commit, reject stale writes with `stale_turn_fence`, and keep reconciliation privileged/idempotent.
- [x] 3.4 Advance the protocol boundary and test renewal, reacquisition, restart, queued-write races, and late model responses.

## 4. Host suspend-safe liveness

- [x] 4.1 Add idempotent Manager suspend/recovering sequences, clock-gap fallback, and twenty-second recovery grace for runtime/thread/resource leases.
- [x] 4.2 Make Runtime local lease deadlines recognize scheduling gaps and revalidate the same fence before aborting.
- [x] 4.3 Wire Electron `powerMonitor` notifications and pause watchdog restart accounting during suspend/recovery.
- [x] 4.4 Add Manager, Runtime, and Main tests for sleep recovery, duplicate events, headless gaps, and competing owners.

## 5. Validation and integration

- [x] 5.1 Run focused Manager, Runtime, usage, and Renderer suites plus the full build, typechecks, lint, file-line gate, and diff checks; record unrelated baseline failures separately.
- [x] 5.2 Verify public usage compatibility and exercise active-turn usage refresh plus suspend/resume recovery in automated lifecycle tests.
- [x] 5.3 Commit the completed change, rebase onto local `develop`, resolve conflicts, and fast-forward integrate without altering source-checkout dirty files.
- [x] 5.4 Prove the temporary commit is contained, remove the worktree and branch, and prune worktree metadata.
