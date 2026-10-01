# Optional persistent Rooms host

Rooms normally runs inside the desktop application's owned Runtime. Closing
the main window still quits that application and drains its Manager, Runtime,
and managed work. This default has not changed.

An operator may instead explicitly start an independent host with the bundled
Kun CLI:

```sh
kun host start
kun host status --json
kun host stop
```

The commands accept `--data-dir <path>` and honor the selected runtime flavor,
`KUN_MANAGER_CONTROL_DIR`, and `KUN_MANAGER_SETTINGS_PATH`. Without an explicit
data directory, the current desktop settings are used when available.

## Ownership and access

- Close the GUI/TUI owner before starting the host on the same profile. A live
  or starting foreign owner fails closed; it is never adopted or replaced.
- The detached host is itself a normal foreground-serve application owner.
  Manager remains the sole physical business-data writer. Existing canonical
  profile reservations, runtime registration, and managed child-process guards
  still fence it.
- `kun tui --no-start` can explicitly connect without taking ownership. A
  non-owning client's exit does not stop the host.
- The default GUI cannot attach to this independent host. Stop the host before
  opening the GUI on that profile. Independent profiles must isolate data,
  control, and settings paths rather than changing the user's original paths.
- Starting a host installs no login item, OS service, scheduled job, or remote
  push service. The computer must remain awake and connected for work to run.

## Honest lifecycle status

`status` distinguishes online (authenticated readiness verified), starting,
unreachable (recorded live owner without readiness), offline, and a conflicting
owner. A recorded PID alone is never proof of online status. The non-secret
record includes the last startup error and log path when available.

`start` is serialized and idempotent for the same verified host. Startup failure
cleans up only the candidate it created. `stop` rechecks the recorded process,
runtime instance, start time, and authenticated shutdown target, then verifies
process exit. An unavailable or changed identity is preserved for inspection.
Neither command deletes conversations, reminders, or results.

After an intentional stop, crash, sleep, or machine restart, run `start` again.
Existing runtime recovery and the durable Rooms queue reconcile incomplete
work. Overdue reminders follow their saved lateness/misfire policy; the host
does not claim they fired while it was offline or invent catch-up results.

## Notifications

Final visible private replies, including reminder replies and attachment-only
results, enter the existing durable Rooms notification queue. Start/progress
messages and internal reminder wake presentations do not create completion
banners. Exact pending approvals and structured-input requests enter the same
stream. Resolved gates are discarded when delivery is retried.

The app-level subscription works outside the Rooms route. Queued delivery
survives renderer reload/reconnect, respects focused conversations and mute
preferences, and records native delivery/suppression receipts in Main. Activity
rows identify Rooms ownership so the global activity notifier does not also
announce the same private turn.

These are local desktop notifications while a supported client is connected;
the independent host alone does not provide remote push. A receipt does not
prove that a person read a banner. A process crash between OS display and
receipt persistence can still produce an at-least-once duplicate on retry.

## Validation limits

Automated tests cover actual detached child startup, concurrent-start
idempotency, exact-instance shutdown, changed-owner refusal, startup failure
cleanup, durable notification receipts, muted delivery, and reconnect replay.
Packaged macOS and Windows host lifecycle and native notification behavior
still require platform smoke tests; Linux fixture-process tests do not prove
those platform-specific behaviors.
