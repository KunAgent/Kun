import { z } from 'zod'
import { RoomIdSchema } from './rooms.js'

export const RoomNotificationPreferenceSchema = z.object({
  roomId: RoomIdSchema,
  mode: z.enum(['all', 'until', 'muted']).default('all'),
  mutedUntil: z.string().datetime({ offset: true }).optional(),
  silencedThrough: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true })
}).strict().refine((value) => value.mode !== 'until' || Boolean(value.mutedUntil), 'timed mute requires an expiry')
export type RoomNotificationPreference = z.infer<typeof RoomNotificationPreferenceSchema>
export type RoomPreferenceDetail = { preference: RoomNotificationPreference; revision: number | null }
export function roomNotificationsMuted(preference: Pick<RoomNotificationPreference, 'mode' | 'mutedUntil'>,
  now = Date.now()): boolean {
  return preference.mode === 'muted' || preference.mode === 'until' && Date.parse(preference.mutedUntil ?? '') > now
}
export function roomNotificationSuppressed(preference: RoomNotificationPreference, createdAt?: string, now = Date.now()): boolean {
  if (roomNotificationsMuted(preference, now)) return true
  const through = preference.silencedThrough ?? (preference.mode === 'until' ? preference.mutedUntil : undefined)
  return Boolean(createdAt && through && Date.parse(createdAt) <= Date.parse(through))
}
export const UpdateRoomNotificationPreferenceSchema = z.object({
  clientRequestId: RoomIdSchema, expectedRevision: z.number().int().nonnegative().nullable(),
  mode: z.enum(['all', 'until', 'muted']), mutedUntil: z.string().datetime({ offset: true }).optional()
}).strict().refine((value) => value.mode !== 'until' || Boolean(value.mutedUntil), 'timed mute requires an expiry')

export const RoomSearchKindSchema = z.enum(['rooms', 'members', 'messages', 'tasks'])
export const RoomSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200), kind: RoomSearchKindSchema,
  roomId: RoomIdSchema.optional(), repositoryRoot: z.string().min(1).max(4096).optional(),
  cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(15),
  includeArchived: z.boolean().default(false)
}).strict()
export type RoomSearchQuery = z.input<typeof RoomSearchQuerySchema>
export type RoomSearchHit = { kind: z.infer<typeof RoomSearchKindSchema>; id: string; roomId: string;
  roomName: string; title: string; preview: string; messageId?: string; memberId?: string; taskId?: string }
export type RoomSearchPage = { results: RoomSearchHit[]; nextCursor?: string }
export type RoomRepositoryChoice = { canonicalRoot: string; displayName: string; roomCount: number }

export const RoomRunSummaryQuerySchema = z.object({
  roomId: RoomIdSchema, rootRequestId: RoomIdSchema.optional(),
  since: z.string().datetime({ offset: true }).optional()
}).strict()
export type RoomRunSummaryQuery = z.infer<typeof RoomRunSummaryQuerySchema>
export type RoomRunSummary = {
  roomId: string; rootRequestId?: string; runs: number; responses: number; triages: number;
  knownUsageRuns: number; partialUsageRuns: number; unknownUsageRuns: number;
  knownTokens: number | null; knownElapsedMs: number | null; knownDurationRuns: number;
  failed: number; stale: number; duplicate: number; skipped: number; cancelled: number;
  budgetPauses: Array<{ rootRequestId: string; reason: string; responsesRemaining: number; triagesRemaining: number }>
}
