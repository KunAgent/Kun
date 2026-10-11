import { z } from 'zod'
import { ParticipantAgentId } from './agent-identities.js'
import { RoomIdSchema } from './rooms.js'

const Timestamp = z.string().datetime({ offset: true })
const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const ReminderTimezoneSchema = z.string().min(1).max(100).refine((value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}, 'timezone must be an IANA timezone')

export const ROOM_REMINDER_LIMITS = {
  minDelaySec: 60, maxDelaySec: 30 * 86400, maxScheduledPerAgent: 20,
  maxFiresPer24h: 24, maxChainDepth: 3, maxLatenessSec: 7 * 86400,
  maxList: 50, maxFireBatch: 200, conditionPollSec: 60
} as const

export const RoomReminderRecurrenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interval'), everySeconds: z.number().int().min(3600).max(30 * 86400) }).strict(),
  z.object({ kind: z.literal('daily'), localTime: LocalTime }).strict(),
  z.object({ kind: z.literal('weekly'), localTime: LocalTime,
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7) }).strict()
])
export const RoomReminderTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('room_idle'), idleSeconds: z.number().int().min(60).max(30 * 86400) }).strict(),
  z.object({ kind: z.literal('message'), authorKind: z.enum(['user', 'agent']),
    contains: z.string().trim().min(1).max(200).optional() }).strict()
])
export const RoomReminderQuietHoursSchema = z.object({ start: LocalTime, end: LocalTime }).strict()
  .refine((value) => value.start !== value.end, 'quiet hours must have different start and end times')

/** Optional additions preserve stored schema-v1 one-off reminders. */
export const RoomReminderOptionsShape = {
  timezone: ReminderTimezoneSchema.optional(),
  recurrence: RoomReminderRecurrenceSchema.optional(),
  trigger: RoomReminderTriggerSchema.optional(),
  quietHours: RoomReminderQuietHoursSchema.optional(),
  dedupKey: z.string().trim().min(1).max(128).optional(),
  expiresAt: Timestamp.optional(),
  maxOccurrences: z.number().int().min(1).max(10000).optional()
}
export const RoomReminderOptionsSchema = z.object(RoomReminderOptionsShape).strict()
export type RoomReminderOptions = z.infer<typeof RoomReminderOptionsSchema>

/** Identity is always host-derived from the private conversation. */
export const RoomReminderSchema = z.object({
  schemaVersion: z.literal(1), reminderId: RoomIdSchema, roomId: RoomIdSchema,
  participantAgentId: ParticipantAgentId, memberId: RoomIdSchema,
  clientSurface: z.enum(['gui', 'im']).optional(), imConnectionId: RoomIdSchema.optional(),
  note: z.string().trim().min(1).max(1000), anchorMessageId: RoomIdSchema.optional(),
  fireAt: Timestamp, status: z.enum(['scheduled', 'paused', 'fired', 'cancelled', 'expired']),
  ...RoomReminderOptionsShape,
  occurrence: z.number().int().nonnegative().optional(),
  triggerCursor: z.number().int().nonnegative().optional(),
  deferredReason: z.enum(['quiet_hours', 'condition_pending', 'fire_budget', 'feature_disabled']).optional(),
  chainDepth: z.number().int().min(0).max(ROOM_REMINDER_LIMITS.maxChainDepth),
  createdByRunId: RoomIdSchema,
  createdAt: Timestamp, updatedAt: Timestamp, firedAt: Timestamp.optional(),
  firedRequestId: z.string().min(1).max(256).optional(),
  endedReason: z.enum(['agent_cancelled', 'user_cancelled', 'room_archived',
    'agent_unavailable', 'too_late', 'schedule_complete', 'condition_expired']).optional()
}).strict()
export type RoomReminder = z.infer<typeof RoomReminderSchema>
export type RoomReminderEntry = RoomReminder & { revision: number }

/** Provenance copied onto the private request that wakes the agent. */
export const RoomPrivateReminderSchema = z.object({
  reminderId: RoomIdSchema,
  chainDepth: z.number().int().min(0).max(ROOM_REMINDER_LIMITS.maxChainDepth),
  scheduledFor: Timestamp,
  lateSeconds: z.number().int().nonnegative(),
  occurrence: z.number().int().nonnegative().optional()
}).strict()
export type RoomPrivateReminder = z.infer<typeof RoomPrivateReminderSchema>
