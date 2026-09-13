import { z } from 'zod'
import { RoomIdSchema } from '../../contracts/rooms.js'
import { RoomRunPhaseSchema, RoomRunStatusSchema } from '../../contracts/room-runs.js'
import { roomRunList, roomRunDetail, roomRunItems, roomMessageRunSource,
  decodeRunCursor, inspectRoomRun } from '../../rooms/room-run-query.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { roomRunEventPage, roomRunEventStream } from './room-run-events.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime,
  request: Request, context: RouteContext) => Promise<unknown> | unknown) => void
const Id = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.coerce.number().int().nonnegative().optional(),
  root_request_id: RoomIdSchema.optional(), member_id: RoomIdSchema.optional(), task_id: RoomIdSchema.optional(),
  request_id: RoomIdSchema.optional(), phase: RoomRunPhaseSchema.optional(), status: RoomRunStatusSchema.optional(),
  search: z.string().trim().max(200).optional()
}).strict()
const ItemsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(40),
  max_bytes: z.coerce.number().int().min(4096).max(256 * 1024).default(128 * 1024),
  cursor: z.string().min(1).max(2048).optional(),
  item_id: z.string().min(1).max(256).optional(),
  call_id: z.string().min(1).max(256).optional(),
  content_offset: z.coerce.number().int().nonnegative().max(64 * 1024 * 1024).optional()
}).strict().refine((value) => value.content_offset === undefined || Boolean(value.item_id),
  'content offset requires an item id')
const query = (request: Request): Record<string, string> => Object.fromEntries(new URL(request.url).searchParams)

export function registerRoomRunRoutes(add: Add, runtime: ServerRuntime): void {
  add('GET', '/v1/rooms/:roomId/runs', async (rooms, request, { params }) => {
    await rooms.service.get(params.roomId)
    const input = ListQuery.parse(query(request))
    return roomRunList(rooms.deps, params.roomId, { limit: input.limit, beforeSeq: input.cursor,
      rootRequestId: input.root_request_id, memberId: input.member_id, taskId: input.task_id,
      requestId: input.request_id, phase: input.phase, status: input.status, search: input.search })
  })
  add('GET', '/v1/rooms/:roomId/messages/:messageId/run', async (rooms, _request, { params }) => {
    await rooms.service.get(params.roomId)
    return roomMessageRunSource(rooms.deps, params.roomId, RoomIdSchema.parse(params.messageId))
  })
  add('GET', '/v1/rooms/:roomId/runs/:runId', async (rooms, _request, { params }) => {
    await rooms.service.get(params.roomId)
    return roomRunDetail(rooms.deps, params.roomId, Id.parse(params.runId))
  })
  add('GET', '/v1/rooms/:roomId/runs/:runId/items', async (rooms, request, { params }) => {
    await rooms.service.get(params.roomId)
    const input = ItemsQuery.parse(query(request))
    return roomRunItems(rooms.deps, params.roomId, Id.parse(params.runId), {
      limit: input.limit, maxBytes: input.max_bytes, before: input.cursor,
      itemId: input.item_id, callId: input.call_id, contentOffset: input.content_offset })
  })
  add('GET', '/v1/rooms/:roomId/runs/:runId/events', async (rooms, request, { params }) => {
    await rooms.service.get(params.roomId)
    const runId = Id.parse(params.runId)
    const input = z.object({ cursor: z.string().max(2048).optional() }).strict().parse(query(request))
    await inspectRoomRun(rooms.deps, params.roomId, runId)
    const raw = input.cursor ?? request.headers.get('last-event-id')
    const cursor = raw ? decodeRunCursor(raw, runId) : { v: 1 as const, id: runId, revision: 0, seq: 0 }
    if (request.headers.get('accept')?.includes('text/event-stream')) return roomRunEventStream({
      runtime, deps: rooms.deps, roomId: params.roomId, runId, request, cursor })
    return roomRunEventPage(rooms.deps, params.roomId, runId, cursor)
  })
}
