import { z } from 'zod'
import { RoomIdSchema, RoomMemberSchema, SendRoomMessageSchema } from './rooms.js'

export const RoomRepositoryInputSchema = z.object({
  id: RoomIdSchema.optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  displayPath: z.string().min(1).max(4096),
  defaultBaseRef: z.string().min(1).max(256).optional()
}).strict()
const fields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().max(8000).optional(),
  collaborationMode: z.enum(['autonomous', 'directed', 'peer']).optional(),
  maxConcurrentTasks: z.number().int().min(1).max(2).optional(),
  defaultMemberId: RoomIdSchema.optional(),
  members: z.array(RoomMemberSchema).min(1).max(100).optional(),
  repositories: z.array(RoomRepositoryInputSchema).max(100).optional()
}
export const CreateRoomRequestSchema = z.object({
  clientRequestId: RoomIdSchema, ...fields
}).strict()
export type CreateRoomRequest = z.input<typeof CreateRoomRequestSchema>
export const UpdateRoomRequestSchema = z.object({
  ...fields,
  name: fields.name.optional(),
  expectedRevision: z.number().int().nonnegative(),
  clientRequestId: RoomIdSchema,
  pinned: z.boolean().optional(),
  archived: z.boolean().optional()
}).strict()
export const RoomTaskActionSchema = z.object({
  clientRequestId: RoomIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  body: z.string().max(64000).optional()
}).strict()
export const RoomRuleRequestSchema = z.object({
  clientRequestId: RoomIdSchema,
  messageId: RoomIdSchema
}).strict()

export const RoomRequestContinueSchema = z.object({
  clientRequestId: RoomIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  message: z.object(SendRoomMessageSchema.shape).omit({ clientRequestId: true }).strict()
    .refine((value) => Boolean(value.body.trim() || value.attachmentIds.length), 'continuation requires text or an attachment')
}).strict()
