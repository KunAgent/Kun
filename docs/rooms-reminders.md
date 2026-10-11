# Room reminders and schedules

An agent can schedule private wake-ups in its own `user_agent` conversation.
Supported schedules include one-off reminders, interval/daily/weekly recurrence,
and room-local conditions. The same agent receives the stored note as quoted
reference context, not a fresh user instruction, and must check the current
situation before deciding whether to call `send_im_message`.

Room, member, participant-agent, and run identity are host-derived from the
active private conversation turn. Model arguments never select an identity.

## Contract and limits

`kun/src/contracts/room-reminders.ts` retains schema-v1 compatibility. Existing
records with no scheduling options remain one-off reminders. States are
`scheduled`, `paused`, `fired`, `cancelled`, and `expired`. Ended records cannot
be resumed. `occurrence` counts committed wakes. `firedAt` and `firedRequestId`
identify the latest wake, including while a recurrence remains scheduled.

Limits are a 60-second minimum initial delay, 30-day maximum explicit initial
delay, 20 active schedules per agent (including paused), 24 actual wakes per
rolling 24 hours, chain depth 3, seven-day lateness allowance, 50 list results,
and 200 due records processed per runtime tick. Recurrence intervals are at
least one hour. A per-agent `room_reminder_budget` CAS ledger serializes
admission and fire accounting; creation and updates/resumption also check
upcoming reservations. Historical fires still count after a schedule ends.

## Scheduling and controls

The private-conversation tools are `schedule_reminder`, `list_reminders`,
`update_reminder`, and `cancel_reminder`. All require the reminders feature at
execution and verify the current running conversation turn and recorded run.
Creation and mutation receipts provide retry safety and reject changed input
under a reused identity. Optional anchor messages must belong to this room.

- One-off: exactly one of `delaySeconds` or an offset-bearing `fireAt`
- Recurrence: `interval` with `everySeconds`, `daily` with `localTime`, or
  `weekly` with `localTime` and Sunday-zero `weekdays`
- Recurrence and `quietHours: { start, end }` require an explicit IANA
  `timezone`; local times use `HH:mm`
- Spring DST gaps skip that date; fall folds fire once
- `maxOccurrences` and `expiresAt` bound the schedule
- `trigger` accepts `room_idle` with `idleSeconds`, or `message` with
  `authorKind: user | agent` and optional case-insensitive `contains`
- A condition without an explicit start first checks after 60 seconds. Pending
  conditions are checked once per minute by the running runtime host
- New-message conditions begin at creation/replacement, coalesce observed
  matching messages, and exclude system presentations
- `dedupKey` rejects another active schedule for the same agent with that key
- `update_reminder` accepts `paused: true | false`. Resuming overdue work uses
  its next future occurrence or a one-off at least 60 seconds ahead

These condition foundations are local conversation checks, not subscriptions
to external app events. Paused schedules retain their active slot and dedup
key. They can still be cancelled.

## Execution, restart, and races

`fireDueRoomReminders` runs on the existing runtime tick while the runtime host
is running. It does not introduce a second runtime or an independent daemon.
Before each occurrence it verifies room/member/agent availability, the default
member binding, feature flag, expiry, quiet hours, current condition, and
rolling fire budget. It freezes current execution permissions through the same
`RoomService.privateDirectRequest` path as an ordinary private request.

A successful wake atomically commits the schedule update, presentation message,
pending private request, and budget entry. The first request retains the legacy
`reminder-fire:<reminderId>` key; later occurrences append `:<occurrence>`.
CAS checks fence concurrent cancellation, pause, edits, room/agent changes, and
feature changes. Replayed ticks and restart do not duplicate an occurrence.

Quiet hours, pending conditions, a disabled feature, and exhausted fire budgets
defer durably with a visible reason. Budget deferral ends when the rolling
window frees capacity. Within the lateness allowance a recurrence may produce
one catch-up wake; outside it the recurrence skips to the next future time.
One-offs outside the allowance expire as `too_late` with a timeline notice.
Missing/archived targets expire without waking. No missed backlog is replayed.

## HTTP and renderer

All endpoints are under the normal authenticated room boundary and require a
private room:

- `GET /v1/rooms/{roomId}/reminders?status=scheduled|paused|all`
- `POST /v1/rooms/{roomId}/reminders/{reminderId}/cancel`
- `POST /v1/rooms/{roomId}/reminders/{reminderId}/pause`
- `POST /v1/rooms/{roomId}/reminders/{reminderId}/resume`

Mutations accept `clientRequestId` and optional `expectedRevision`. User
cancellation records `user_cancelled`. Agents create/edit schedules through
their bound tools. The reminder drawer displays explicit timezone, recurrence,
condition, quiet hours, current status and deferral reason; pause/resume/cancel
controls are request-fenced and disable repeated clicks while awaiting a result.
