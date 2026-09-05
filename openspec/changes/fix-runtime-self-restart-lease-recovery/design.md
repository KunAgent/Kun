## Context

Kun uses a shared Runtime supervised by a Service Manager. The Manager is the single writer for thread state and owns fenced execution leases, while the Runtime executes turns and renews those leases. A Runtime-hosted shell can currently invoke `kun runtime restart` against the same instance. During shutdown the lease client discards its local lease map before active turns suspend, so the later release becomes a no-op. The replacement Runtime initially observes the old Manager lease and skips orphan recovery; after the lease expires, the Manager writes `owner_lease_expired` and the active goal remains stranded.

The repair spans CLI identity, shell environment filtering, lease-client lifecycle, Runtime shutdown ordering, turn/goal persistence, startup reconciliation, and renderer canonical-state handling. Manager fencing and existing restart authorization remain the safety boundary.

## Goals / Non-Goals

**Goals:**

- Refuse only exact same-instance Runtime stop/restart requests originating from agent-controlled execution.
- Release every held Manager execution lease before Runtime unregister and preserve fencing until release acknowledgement.
- Persist exactly measured goal elapsed time before a graceful suspension releases ownership.
- Classify and exactly-once resume `owner_lease_expired` interruptions, including records created before durable terminal codes exist.
- Keep goal/todo projections canonical and provide a safe manual recovery fallback.

**Non-Goals:**

- Increasing lease TTLs or accepting writes without a valid mutation fence.
- Adding a general active-turn restart ban, a new force flag, or changing trusted external/GUI restart authorization.
- Reintroducing a second Runtime, legacy provider/process-manager surfaces, Runtime diagnostics UI, or renderer-driven automatic recovery.
- Expanding restart process cleanup to ordinary startup, watchdog, updater, or GUI quit paths.
- Adding or versioning HTTP routes, SSE events, or Manager lease protocol DTOs.
- Estimating elapsed time across hard crashes or Runtime downtime.

## Decisions

### Exact Runtime identity is the self-control boundary

The Runtime already owns `KUN_RUNTIME_INSTANCE_ID`. The agent shell will expose only this non-secret marker through its safe environment allowlist. Before CLI stop/restart posts shutdown, it will compare that marker with the target discovery record's `instanceId`, even if the target health endpoint is unavailable, and repeat the comparison against the final inspected record immediately before the shutdown request. Equality returns exit code 70 with stable code `runtime_self_control_forbidden`; absence or inequality preserves external control behavior. This marker is an accidental self-control guard, not an authorization secret; existing authenticated lifecycle controls remain the security boundary.

This is preferred over an active-turn gate because a trusted external restart is intentionally allowed to interrupt and recover work. It is also preferred over PID matching because discovery instance identity is already the authoritative lifecycle identity.

### Lease shutdown is an asynchronous release barrier

`ThreadExecutionLeasePort.shutdown` becomes `Promise<void>`. The Manager lease client uses `open`, `closing`, and `closed` states with one cached shutdown promise. Closing blocks new acquisitions, stops renewal scheduling, waits for in-flight acquisitions, releases late acquisitions immediately, deduplicates normal and shutdown releases by full lease generation, and drains remaining leases in parallel.

Lease maps and mutation fences remain installed until Manager acknowledges that generation as released or already absent. `{released:false}` is an idempotent success. A bounded release retry that still ends in transport failure leaves that generation's fail-closed fence installed, does not prevent other releases, and contributes to one aggregate shutdown error. A same-thread/same-turn acquire waits for its pending release, because Manager may otherwise return the still-current fencing token; generation-aware comparisons then prevent delayed responses for distinct generations from clearing newer ownership. No separate public drain method or Manager protocol change is needed.

### Active turns retain ownership until suspension state is durable

Runtime shutdown first closes a TurnService admission gate and waits for in-flight start, steer, and Graph-resume mutations to leave their admission critical sections. It then stops resume schedulers, quiesces Graph workers, suspends Direct and Graph turns with `releaseLease: false`, stops Graph, and waits within the existing active-run bound. Goal and ordinary automatic continuations launch through the same host-owned run tracker as HTTP, Graph, review, and extension turns, so their suspended cleanup is inside that bound too. Suspended AgentLoop cleanup invokes `goalTurns.afterSuspended`, which only finalizes the current reliable elapsed timer for the same goal generation. Runtime shutdown then awaits the lease-client release barrier before closing stores and unregistering.

Ordinary terminal cleanup and Graph parking continue to release leases by default. Shutdown phases collect failures independently so a suspension, Graph-stop, or active-run rejection cannot skip later lease draining. If a run does not unwind within the existing bound, shutdown proceeds without estimating elapsed time. Release failures are reported while remaining cleanup still runs; Manager expiry remains the fail-closed fallback.

### Recoverability is a durable terminal classification

The optional Turn field `terminalCode` stores bounded machine-readable terminal reasons without invalidating existing session data. When Manager directly fails a turn it also writes internal `managerLeaseSettlement` provenance containing the owner instance, flavor, fencing token, and settlement time. Public thread and turn projections remove both recovery-only fields; the existing canonical error item remains the renderer-facing signal.

Manager registration first expires stale predecessor leases and durably reconciles every one before registering a replacement Runtime. Every Runtime startup mode scans only Manager-proven settlements within one bounded startup window. Legacy records without either new field are accepted only when their latest failed turn has the exact deterministic canonical error item within the same window. A thread becomes resumable only after its deterministic interruption checkpoint is durably applied or already present; conflicts and storage errors remain fail-closed. Reconciliation carries the exact thread/turn source through routing, drops child-recovery evidence whose parent turn is not that source, and atomically requires that source to remain the latest failed turn during continuation admission. A currently active goal uses goal continuation; a thread with no active goal uses the existing ordinary continuation path even when it retains a completed, paused, blocked, or usage-limited goal record from earlier work.

### Explicit null remains authoritative in the renderer

Runtime snapshot fields use `undefined` for compatibility with providers that omit goal/todos and `null` for an authoritative clear. Projection and prefetch fallbacks therefore test `=== undefined` instead of nullish coalescing. Delayed detail responses are fenced independently against their sequence, tagged turn, detail latest turn, and projected latest turn before they can replace newer goal, todo, sidebar, or live-turn state. An identity-stale tagged response also cannot advance the SSE cursor because it did not import the newer events represented by that high-water. The renderer localizes `owner_lease_expired` and exposes Continue only on the latest settled turn while the whole thread is idle and the parent supplies a main-thread action; automatic recovery remains backend-owned.

## Risks / Trade-offs

- **A Manager transport failure can still prevent a clean release.** → Drain every lease, preserve fail-closed fencing, surface an aggregate shutdown error, and let existing expiry reconciliation recover safely.
- **A late acquire or renew response can race with shutdown.** → Track in-flight acquisitions, release successful late acquisitions immediately, and prohibit closing-state responses from reinstalling timers or fences.
- **Startup reconciliation could duplicate continuations.** → Require a committed deterministic checkpoint, bind scheduling to the exact latest failed turn, and reuse existing cooldown/capacity gates.
- **Provider data could spoof a recovery code.** → Require Manager-authored settlement provenance for new records; accept legacy data only through the exact canonical item and bounded startup window, never fuzzy-match messages.
- **The internal Turn schema gains a field.** → Keep it optional and bounded; existing persisted turns and clients remain valid.

## Migration Plan

No one-time data migration is required. New failures persist `terminalCode`; startup reconciliation transparently recognizes both new records and the exact canonical legacy error item. The change is rolled back by reverting the code and optional field readers; persisted optional fields remain harmless to the previous schema.

## Open Questions

None.
