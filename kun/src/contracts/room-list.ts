import { z } from 'zod'
import { RoomMessageSchema, type Room } from './rooms.js'

/** Derived list metadata; never persisted as part of a room document. */
export const RoomLatestMessageSchema = RoomMessageSchema.pick({
  id: true,
  authorKind: true,
  authorMemberId: true,
  authorLabelSnapshot: true,
  createdAt: true
}).extend({
  preview: z.string().refine((value) => Array.from(value).length <= 160, 'message preview is too long'),
  attachmentCount: z.number().int().min(0).max(20)
}).strict()
export type RoomLatestMessage = z.infer<typeof RoomLatestMessageSchema>

export type RoomListEntry = Room & {
  latestMessage?: RoomLatestMessage
  latestMessageSeq?: number
  readSeq?: number
  runningCount?: number
  attentionCount?: number
}
