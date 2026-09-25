# Room reminders

Room reminders are one-shot wake-ups an agent schedules for itself inside its
own private `user_agent` conversation. When a reminder fires, the runtime wakes
the same agent in that private chat with the stored note as reference context;
the agent decides whether the user should see a follow-up.

The identity boundary is absolute: **room, member, agent and run identity are
host-derived from the active conversation turn — the model only supplies the
note, the fire time, and optionally an anchor message.** A fired reminder is
quoted context, never a fresh user instruction, and it produces a visible reply
only when the agent explicitly calls `send_im_message`.

## Contract

`kun/src/contracts/room-reminders.ts` defines the durable `room_reminder`
document. Statuses are `scheduled`, `fired`, `cancelled` and `expired`; ended
reminders are immutable. `endedReason` records how an ended reminder stopped:
`agent_cancelled`, `user_cancelled`, `room_archived`, `agent_unavailable` or
`too_late`. `chainDepth` bounds reminder-driven follow-up chains.

`ROOM_REMINDER_LIMITS` bounds the feature: at least 60 seconds and at most 30
days of delay, at most 20 scheduled reminders per agent, at most 24 fires per
rolling 24-hour window (scheduled-in-window plus recently fired), a maximum
follow-up chain depth of 3, a lateness bound of 7 days, a 50-entry list cap,
and a 200-entry fire batch per tick.

`RoomPrivateReminder` is the provenance copied onto the wake request:
`reminderId`, `chainDepth`, `scheduledFor` and `lateSeconds`.

## Scheduling

`createRoomReminder` (`kun/src/rooms/room-reminders.ts`) validates timing,
verifies the room is a `user_agent` conversation and the member is the enabled
participant agent, enforces the scheduled cap and the 24-hour fire budget, then
commits the record under a `reminder-create` interaction receipt. Retried
schedules replay the first accepted result; a reused receipt with different
input is a conflict. `updateRoomReminder` may edit the note or fire time of a
still-scheduled reminder with revision checks. `cancelRoomReminder` is
idempotent for already-cancelled entries and rejects fired/expired ones.

## Conversation tools

`kun/src/rooms/room-reminder-tools.ts` advertises `schedule_reminder`,
`list_reminders`, `update_reminder` and `cancel_reminder` only in private
agent conversation turns (`roomAgent` + `roomStepKind: 'conversation'`). The
binding mirrors `send_im_message`: the active running turn, its recorded
`room_run`, the bound member and the host-derived participant agent — model
arguments can never carry identity fields. All four tools require the
`reminders` agent feature flag at execution time. `schedule_reminder` refuses
to chain beyond `maxChainDepth` when the current turn was itself a reminder
wake, so an agent cannot postpone forever instead of acting.

## Firing

`fireDueRoomReminders` runs on the room runtime tick — only while the
application is open. A restart never back-fires blindly: overdue reminders are
reconciled by the same lateness rules. Firing verifies the room still exists
and is unarchived, the conversation is still `user_agent`, the member is still
the enabled default member bound to the same agent, and the agent identity is
unarchived. A reminder that is more than `maxLatenessSec` late, or whose room,
member or agent is gone, expires instead of waking (`too_late`,
`room_archived`, `agent_unavailable`); only `too_late` leaves a visible
notification in the timeline.

A successful fire commits three documents atomically under the deterministic
request id `reminder-fire:<reminderId>`:

1. the `room_reminder` record, now `fired` with `firedAt`/`firedRequestId`;
2. a presentation `message` with `presentationKind: 'reminder'` carrying the
   note;
3. a pending private request with `privateReminder` provenance, built through
   the same `RoomService.privateDirectRequest` path as ordinary user sends —
   permission freezing, direct model binding and the room snapshot are shared.

Revision checks make a concurrent user cancel or a replayed tick a no-op, so a
reminder fires at most once. Presentation messages are excluded from memory
capture: the durable record stays queryable through `list_reminders`.

## The wake turn

`AgentDirectRunner.reminderWakeInput` frames the fired reminder as quoted
reference material: the note, the scheduled time, the lateness and an optional
anchor message excerpt, with an explicit instruction that this is not a new
user instruction. The agent then runs an ordinary private turn; a visible
reply is emitted only through `send_im_message` when follow-up is warranted.

## Routes and renderer

- `GET /v1/rooms/{roomId}/reminders?status=scheduled|all` — list the room's
  reminders (`all` includes recently ended ones).
- `POST /v1/rooms/{roomId}/reminders/{reminderId}/cancel` — user cancellation
  with `{ clientRequestId, expectedRevision? }`; always records
  `user_cancelled`.

Agents manage reminders only through their own conversation tools, not HTTP.
Both routes require a `user_agent` room.

In the renderer, `RoomReminderList` is reachable from the private chat header
menu (`roomsReminders`) and renders as a drawer panel. Fired reminders appear
in the timeline as a distinct reminder presentation. The `reminders` feature
toggle lives next to the other agent feature flags.
