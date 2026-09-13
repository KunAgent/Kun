import { z } from 'zod'

const RoomIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
const RoomTimestampSchema = z.string().datetime({ offset: true })
const RoomCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const RoomPageLimitSchema = z.number().int().min(1).max(100).default(50)
const RoomListCursorSchema = z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/)
const RoomHistoryCursorSchema = z.string().min(1).max(16).regex(/^(0|[1-9]\d*)$/)
  .refine((value) => Number.isSafeInteger(Number(value)), 'Expected a safe integer cursor')

export const RoomTaskStatusSchema = z.enum([
  'queued', 'waiting_dependency', 'running', 'needs_input', 'needs_approval',
  'recovery_required', 'stopping', 'awaiting_acceptance', 'completed', 'failed', 'cancelled'
])
export type RoomTaskStatus = z.infer<typeof RoomTaskStatusSchema>

export const RoomTaskCountsSchema = z.strictObject({
  queued: RoomCountSchema,
  waiting_dependency: RoomCountSchema,
  running: RoomCountSchema,
  needs_input: RoomCountSchema,
  needs_approval: RoomCountSchema,
  recovery_required: RoomCountSchema,
  stopping: RoomCountSchema,
  awaiting_acceptance: RoomCountSchema,
  completed: RoomCountSchema,
  failed: RoomCountSchema,
  cancelled: RoomCountSchema
})
export type RoomTaskCounts = z.infer<typeof RoomTaskCountsSchema>

export const RoomSummarySchema = z.strictObject({
  id: RoomIdSchema,
  name: z.string().min(1).max(120),
  collaborationMode: z.enum(['autonomous', 'directed', 'peer']),
  updatedAt: RoomTimestampSchema,
  memberCount: RoomCountSchema,
  taskCounts: RoomTaskCountsSchema
})
export type RoomSummary = z.infer<typeof RoomSummarySchema>

export const RoomMessageAttachmentSchema = z.strictObject({
  id: z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  displayName: z.string().min(1).max(512)
})
export type RoomMessageAttachment = z.infer<typeof RoomMessageAttachmentSchema>

export const RoomMessageSchema = z.strictObject({
  id: RoomIdSchema,
  authorMemberId: RoomIdSchema.optional(),
  authorDisplayName: z.string().max(120),
  body: z.string().max(64_000),
  createdAt: RoomTimestampSchema,
  replyToMessageId: RoomIdSchema.optional(),
  mentionedMemberIds: z.array(RoomIdSchema).max(100),
  attachments: z.array(RoomMessageAttachmentSchema).max(20)
})
export type RoomMessage = z.infer<typeof RoomMessageSchema>

export const RoomTaskSummarySchema = z.strictObject({
  id: RoomIdSchema,
  status: RoomTaskStatusSchema,
  title: z.string().min(1).max(240),
  memberId: RoomIdSchema,
  repositoryDisplayName: z.string().min(1).max(120).optional(),
  updatedAt: RoomTimestampSchema
})
export type RoomTaskSummary = z.infer<typeof RoomTaskSummarySchema>

/** Public invalidation events only; clients fetch the corresponding read projection. */
export const RoomEventSchema = z.strictObject({
  type: z.enum([
    'room.created', 'room.updated', 'message.created', 'message.updated',
    'task.created', 'task.updated', 'task.cleaned', 'task.recovered', 'task.amended'
  ]),
  sequence: RoomCountSchema.refine((value) => value > 0, 'Expected a positive sequence'),
  timestamp: RoomTimestampSchema,
  roomId: RoomIdSchema,
  payload: z.strictObject({ id: RoomIdSchema, taskId: RoomIdSchema.optional() })
})
export type RoomEvent = z.infer<typeof RoomEventSchema>

export const RoomListRequestSchema = z.strictObject({
  limit: RoomPageLimitSchema,
  cursor: RoomListCursorSchema.optional()
})
export type RoomListRequest = z.input<typeof RoomListRequestSchema>
export const RoomListResponseSchema = z.strictObject({
  items: z.array(RoomSummarySchema).max(100),
  page: z.strictObject({ hasMore: z.boolean(), nextCursor: RoomListCursorSchema.optional() })
})
export type RoomListResponse = z.infer<typeof RoomListResponseSchema>

export const RoomMessagesListRequestSchema = z.strictObject({
  roomId: RoomIdSchema,
  cursor: RoomHistoryCursorSchema.optional(),
  limit: RoomPageLimitSchema
})
export type RoomMessagesListRequest = z.input<typeof RoomMessagesListRequestSchema>
const RoomHistoryPageSchema = z.strictObject({
  hasMore: z.boolean(), nextCursor: RoomHistoryCursorSchema.optional()
})
export const RoomMessagesListResponseSchema = z.strictObject({
  items: z.array(RoomMessageSchema).max(100),
  page: RoomHistoryPageSchema
})
export type RoomMessagesListResponse = z.infer<typeof RoomMessagesListResponseSchema>

export const RoomTasksListRequestSchema = z.strictObject({
  roomId: RoomIdSchema,
  status: RoomTaskStatusSchema.optional(),
  cursor: RoomHistoryCursorSchema.optional(),
  limit: RoomPageLimitSchema
})
export type RoomTasksListRequest = z.input<typeof RoomTasksListRequestSchema>
export const RoomTasksListResponseSchema = z.strictObject({
  items: z.array(RoomTaskSummarySchema).max(100),
  page: RoomHistoryPageSchema
})
export type RoomTasksListResponse = z.infer<typeof RoomTasksListResponseSchema>

export const RoomEventsListRequestSchema = z.strictObject({
  roomId: RoomIdSchema,
  after: RoomCountSchema.default(0),
  limit: RoomPageLimitSchema
})
export type RoomEventsListRequest = z.input<typeof RoomEventsListRequestSchema>
export const RoomEventsListResponseSchema = z.strictObject({
  items: z.array(RoomEventSchema).max(100),
  cursor: RoomCountSchema,
  hasMore: z.boolean()
})
export type RoomEventsListResponse = z.infer<typeof RoomEventsListResponseSchema>

/** Requires rooms.read. This scope grants read access across the local rooms trust domain. */
export interface RoomsApi {
  list(request?: RoomListRequest): Promise<RoomListResponse>
  listMessages(request: RoomMessagesListRequest): Promise<RoomMessagesListResponse>
  listTasks(request: RoomTasksListRequest): Promise<RoomTasksListResponse>
  listEvents(request: RoomEventsListRequest): Promise<RoomEventsListResponse>
}
