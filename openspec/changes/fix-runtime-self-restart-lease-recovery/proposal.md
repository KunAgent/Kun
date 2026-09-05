## Why

A Kun Runtime can currently execute `kun runtime restart` against itself, clearing its local execution-lease state before active turns finish suspending. The Manager then expires the still-running turn as `owner_lease_expired`, leaving a recoverable conversation failed while its goal and todos remain active.

## What Changes

- Reject `kun runtime stop` and `kun runtime restart` only when the command is running inside the exact Runtime instance it targets; keep explicit external and GUI restart behavior unchanged.
- Make execution-lease shutdown asynchronous and wait for all Manager release acknowledgements before Runtime unregister or store shutdown.
- Suspend active turns before draining their leases and persist only reliably measured goal elapsed time during a graceful handoff.
- Persist a stable terminal reason plus Manager-authored settlement provenance, settle expired predecessor leases before admitting a replacement Runtime, and reconcile recent authoritative `owner_lease_expired` interruptions into the existing exactly-once continuation paths.
- Treat explicit `null` goal/todo snapshots as authoritative in the renderer and expose a localized, safe manual Continue fallback for recoverable lease interruptions.

## Capabilities

### New Capabilities

- `same-runtime-control-safety`: Prevent an agent-hosting Runtime from stopping or restarting that exact instance while preserving trusted external controls.
- `graceful-turn-lease-handoff`: Suspend active work, account reliable elapsed time, and drain Manager execution leases before Runtime teardown.
- `manager-settled-interruption-recovery`: Durably classify and exactly-once resume recoverable lease-expiry interruptions while keeping renderer state canonical.

### Modified Capabilities

None.

## Impact

- Affects the Kun runtime CLI, safe shell environment, Manager execution-lease client, Runtime shutdown composition, goal lifecycle, turn persistence and startup reconciliation.
- Adds optional backward-compatible `terminalCode` and internal Manager-settlement fields to the Turn contract; public thread/turn projections omit the provenance, and no HTTP route, SSE event, lease TTL, or Manager protocol version changes are required.
- Updates renderer snapshot reconciliation and runtime error presentation, plus focused Kun and renderer tests and the Kun CLI/TUI documentation.
