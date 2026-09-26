import { z } from 'zod'
import { ParticipantAgentId } from './agent-identities.js'
import { RoomIdSchema } from './rooms.js'

const Timestamp = z.string().datetime({ offset: true })

/** One-shot reminder limits: private agents may only nudge themselves in bounded ways. */
export const ROOM_REMINDER_LIMITS = {
  minDelaySec: 60,
  maxDelaySec: 30 * 86400,
  maxScheduledPerAgent: 20,
  maxFiresPer24h: 24,
  maxChainDepth: 3,
  maxLatenessSec: 7 * 86400,
  maxList: 50,
  maxFireBatch: 200
} as const

/**
 * A durable one-shot reminder an agent scheduled inside its own private
 * user-agent conversation. Identity fields are always host-derived; the model
 * only supplies the note, the time, and optionally an anchor message.
 */
export const RoomReminderSchema = z.object({
  schemaVersion: z.literal(1), reminderId: RoomIdSchema, roomId: RoomIdSchema,
  participantAgentId: ParticipantAgentId, memberId: RoomIdSchema,
  note: z.string().trim().min(1).max(1000), anchorMessageId: RoomIdSchema.optional(),
  fireAt: Timestamp, status: z.enum(['scheduled', 'fired', 'cancelled', 'expired']),
  chainDepth: z.number().int().min(0).max(ROOM_REMINDER_LIMITS.maxChainDepth),
  createdByRunId: RoomIdSchema,
  createdAt: Timestamp, updatedAt: Timestamp, firedAt: Timestamp.optional(),
  // The wake request id is `reminder-fire:<reminderId>`; request document ids
  // are not RoomIdSchema-shaped, so this stores the plain document id.
  firedRequestId: z.string().min(1).max(256).optional(),
  endedReason: z.enum(['agent_cancelled', 'user_cancelled', 'room_archived',
    'agent_unavailable', 'too_late']).optional()
}).strict()
export type RoomReminder = z.infer<typeof RoomReminderSchema>
export type RoomReminderEntry = RoomReminder & { revision: number }

/** Provenance copied onto the private request that wakes the agent. */
export const RoomPrivateReminderSchema = z.object({
  reminderId: RoomIdSchema,
  chainDepth: z.number().int().min(0).max(ROOM_REMINDER_LIMITS.maxChainDepth),
  scheduledFor: Timestamp,
  lateSeconds: z.number().int().nonnegative()
}).strict()
export type RoomPrivateReminder = z.infer<typeof RoomPrivateReminderSchema>
