import { z } from 'zod'
import type { Room } from '../contracts/rooms.js'
import type { RoomRequestOutcome } from '../contracts/rooms-product.js'

export const RoomDocumentKindSchema = z.enum([
  'room', 'message', 'request', 'task', 'dispatch', 'attempt',
  'workspace', 'delivery', 'review', 'amendment', 'rule', 'artifact',
  'rule_version', 'context', 'summary', 'outcome', 'recovery', 'integration', 'read_state', 'cleanup', 'validation',
  'request_input', 'rule_bundle', 'rule_compression'
])
export type RoomDocumentKind = z.infer<typeof RoomDocumentKindSchema>
const Id = z.string().min(1).max(256)
const Seq = z.number().int().nonnegative()

export const RoomStoredDocumentSchema = z.object({
  kind: RoomDocumentKindSchema,
  id: Id,
  roomId: Id.optional(),
  taskId: Id.optional(),
  revision: Seq,
  seq: Seq,
  value: z.unknown()
}).strict()
export type RoomStoredDocument<T = unknown> = Omit<z.infer<typeof RoomStoredDocumentSchema>, 'value'> & {
  value: T
}

export const RoomStoreEventSchema = z.object({
  seq: Seq,
  roomId: Id,
  kind: z.string().min(1).max(128),
  payload: z.unknown(),
  createdAt: z.string().datetime({ offset: true })
}).strict()
export type RoomStoreEvent = z.infer<typeof RoomStoreEventSchema>

export const RoomStoreListOptionsSchema = z.object({
  roomId: Id.optional(),
  taskId: Id.optional(),
  status: z.union([z.string(), z.array(z.string()).max(30)]).optional(),
  limit: z.number().int().min(1).max(1000).default(50),
  beforeSeq: Seq.optional(),
  afterSeq: Seq.optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  includeArchived: z.boolean().default(false),
  archivedOnly: z.boolean().default(false),
  search: z.string().trim().max(200).optional(),
  activityOnly: z.boolean().optional(),
  summaryOnly: z.boolean().optional(),
  deliveryId: Id.optional(),
  threadId: Id.optional(),
  memberId: Id.optional(), repositoryId: Id.optional(), requestId: Id.optional(), documentId: Id.optional()
}).strict()
export type RoomStoreListOptions = z.input<typeof RoomStoreListOptionsSchema>
export const RoomOutcomeQuerySchema = z.object({
  roomId: Id.optional(), requestIds: z.array(Id).max(200).optional(),
  pendingOnly: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional()
}).strict()
export type RoomOutcomeQuery = z.infer<typeof RoomOutcomeQuerySchema>

const RoomListCursorSchema = z.object({ pinned: z.union([z.literal(0), z.literal(1)]),
  activitySeq: z.number().int().nonnegative(), id: z.string().min(1).max(256) }).strict()
export const RoomListOptionsSchema = z.object({
  cursor: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/).refine((value) => {
    try { return RoomListCursorSchema.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))).success }
    catch { return false }
  }, 'invalid room page cursor').optional(),
  archivedOnly: z.boolean().default(false),
  search: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(1000).default(50)
}).strict()
export type RoomListOptions = z.input<typeof RoomListOptionsSchema>
export type RoomListPage = {
  rooms: Array<RoomStoredDocument<Room> & { latestMessageSeq: number }>
  nextCursor?: string
}

export const RoomStoreCommitSchema = z.object({
  requestId: Id,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  checks: z.array(z.object({
    kind: RoomDocumentKindSchema,
    id: Id,
    // null means the document must not exist; the first persisted revision is 0.
    expectedRevision: Seq.nullable()
  }).strict()).max(1000).default([]),
  puts: z.array(z.object({
    kind: RoomDocumentKindSchema,
    id: Id,
    roomId: Id.optional(),
    taskId: Id.optional(),
    value: z.unknown()
  }).strict()).max(1000).default([]),
  events: z.array(z.object({
    roomId: Id,
    kind: z.string().min(1).max(128),
    payload: z.unknown()
  }).strict()).max(1000).default([]),
  result: z.unknown().optional()
}).strict()
export type RoomStoreCommit = z.input<typeof RoomStoreCommitSchema>

export const RoomStoreCommitResultSchema = z.object({
  duplicate: z.boolean(),
  result: z.unknown(),
  events: z.array(RoomStoreEventSchema)
}).strict()
export type RoomStoreCommitResult = z.infer<typeof RoomStoreCommitResultSchema>
export const RoomStoreRequestSchema = z.object({
  requestId: Id,
  fingerprint: z.string(),
  result: z.unknown(),
  events: z.array(RoomStoreEventSchema)
}).strict()
export type RoomStoreRequest = z.infer<typeof RoomStoreRequestSchema>

/** Canonical room storage. Each commit and its replay cursor become durable together. */
export interface RoomStore {
  get<T = unknown>(kind: RoomDocumentKind, id: string): Promise<RoomStoredDocument<T> | null>
  list<T = unknown>(kind: RoomDocumentKind, options?: RoomStoreListOptions): Promise<RoomStoredDocument<T>[]>
  listRooms(options?: RoomListOptions): Promise<RoomListPage>
  commit(input: RoomStoreCommit): Promise<RoomStoreCommitResult>
  getRequest(requestId: string): Promise<RoomStoreRequest | null>
  events(roomId: string, sinceSeq?: number, limit?: number): Promise<RoomStoreEvent[]>
  latestEventSeq?(): Promise<number>
  eventScope?(): Promise<string>
  requestOutcomes?(input: RoomOutcomeQuery): Promise<{ outcomes: RoomRequestOutcome[]; initializing: boolean }>
  assertOwnership(): Promise<void>
  close(): Promise<void>
}

export class RoomStoreConflictError extends Error {
  constructor(message: string, readonly currentRevision: number | null = null) {
    super(message)
    this.name = 'RoomStoreConflictError'
  }
}
