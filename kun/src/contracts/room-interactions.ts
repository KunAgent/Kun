import { z } from 'zod'
import { RoomIdSchema } from './rooms.js'

const Id = RoomIdSchema
export const ROOM_REACTION_EMOJI = ['👍', '❤️', '😂', '🎉', '🤔', '👀', '✅', '🚀', '👏', '🙏', '🔥', '💯', '😊', '😮', '😢', '👎', '💡', '🙌', '⭐', '🐱', '🐶', '🌟', '💪', '🫡'] as const
export const RoomReactionInputSchema = z.object({ clientRequestId: Id,
  emoji: z.enum(ROOM_REACTION_EMOJI), active: z.boolean() }).strict()
export const RoomMessageReactionsSchema = z.object({ roomId: Id, messageId: Id,
  reactions: z.array(z.object({ emoji: z.enum(ROOM_REACTION_EMOJI), count: z.number().int().positive(), reacted: z.boolean() }).strict()).max(24),
  revision: z.number().int().nonnegative() }).strict()
export type RoomMessageReactions = z.infer<typeof RoomMessageReactionsSchema>
export const RoomPollOptionSchema = z.object({ id: Id, label: z.string().trim().min(1).max(200) }).strict()
export const RoomPollSnapshotSchema = z.object({ pollId: Id, question: z.string().trim().min(1).max(300),
  options: z.array(RoomPollOptionSchema).min(2).max(10), multiple: z.boolean(), closesAt: z.string().datetime().optional() }).strict()
export const RoomPollInvitationSchema = RoomPollSnapshotSchema.extend({ memberIds: z.array(Id).min(1).max(100),
  pollRevision: z.number().int().nonnegative() }).strict()
export type RoomPollInvitation = z.infer<typeof RoomPollInvitationSchema>
export const RoomPollSchema = RoomPollSnapshotSchema.extend({ roomId: Id, messageId: Id,
  state: z.enum(['open', 'closed', 'expired']), createdAt: z.string().datetime(), closedAt: z.string().datetime().optional(),
  revision: z.number().int().nonnegative(),
  ballots: z.record(z.string(), z.object({ optionIds: z.array(Id).max(10), updatedAt: z.string().datetime(),
    memberId: Id.optional(), requestId: Id.optional(), threadId: z.string().optional(), turnId: z.string().optional() }).strict()) }).strict()
export type RoomPoll = z.infer<typeof RoomPollSchema>
export const CreateRoomPollSchema = z.object({ clientRequestId: Id, question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(10), multiple: z.boolean().default(false),
  closesAt: z.string().datetime().optional(), replyToMessageId: Id.optional()
}).strict().refine((value) => new Set(value.options).size === value.options.length, 'poll options must be distinct')
export const RoomPollVoteSchema = z.object({ clientRequestId: Id, optionIds: z.array(Id).max(10) }).strict()
export const RoomPollActionSchema = z.object({ clientRequestId: Id }).strict()
export const RoomPollInviteSchema = RoomPollActionSchema.extend({ memberIds: z.array(Id).min(1).max(100) }).strict()
export type RoomMessageInteractions = { reactions: RoomMessageReactions; poll?: RoomPoll }
