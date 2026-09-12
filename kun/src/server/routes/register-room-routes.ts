import { z } from 'zod'
import { RoomIdSchema } from '../../contracts/rooms.js'
import { RoomRuleRequestSchema } from '../../contracts/rooms-api.js'
import { RoomTaskStatusSchema } from '../../contracts/room-tasks.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RoomTaskExecution } from '../../rooms/room-runtime-types.js'
import { RoomStoreConflictError, RoomListOptionsSchema } from '../../rooms/room-store.js'
import { ServiceManagerHttpError, ServiceManagerTransportError } from '../../manager/usage-errors.js'
import type { Router, RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import { roomEventStream } from './room-event-stream.js'

const PageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().nonnegative().optional()
})
class RoomBodyError extends Error {
  constructor(readonly response: JsonResponse) { super('invalid room request body') }
}
async function body(request: Request): Promise<unknown> {
  const result = await readJsonBody(request)
  if (!result.ok) throw new RoomBodyError(result.response)
  return result.value
}
function pagination(request: Request) {
  const params = new URL(request.url).searchParams
  return PageSchema.parse({ limit: params.get('limit') ?? undefined, cursor: params.get('cursor') ?? undefined })
}

export function registerRoomRoutes(router: Router, runtime: ServerRuntime): void {
  type Handler = (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown
  const add = (method: string, path: string, handle: Handler): void => router.add(method, path, async (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.rooms) return ERRORS.unavailable('rooms are not available')
    try {
      if (context.params.roomId) RoomIdSchema.parse(context.params.roomId)
      if (context.params.taskId) RoomIdSchema.parse(context.params.taskId)
      const result = await handle(runtime.rooms, request, context)
      return result instanceof Response ? result : jsonResponse(result)
    } catch (error) {
      if (error instanceof RoomBodyError) return error.response
      if (error instanceof z.ZodError) return ERRORS.validation('invalid room request', error.issues)
      if (error instanceof RoomStoreConflictError) return jsonResponse({ code: 'room_conflict',
        message: error.message, currentRevision: error.currentRevision }, 409)
      if (error instanceof ServiceManagerHttpError || error instanceof ServiceManagerTransportError) {
        return ERRORS.unavailable('room persistence is temporarily unavailable')
      }
      const message = error instanceof Error ? error.message : String(error)
      if (/not found$/i.test(message)) return ERRORS.notFound(message)
      return ERRORS.internal(message)
    }
  })

  add('GET', '/v1/rooms/presets', (rooms) => {
    const presets = new Map([
      ['coordinator', { id: 'coordinator', name: 'Coordinator', description: 'Coordinate the room within the user goal.' }],
      ['developer', { id: 'developer', name: 'Developer', description: 'Implement and verify assigned repository tasks.' }],
      ['reviewer', { id: 'reviewer', name: 'Reviewer', description: 'Review an immutable delivery using read-only tools.' }]
    ])
    for (const [id, profile] of Object.entries(rooms.deps.profiles())) {
      presets.set(id, { id, name: profile.name ?? id, description: profile.description ?? '' })
    }
    return { presets: [...presets.values()] }
  })
  add('GET', '/v1/rooms', (rooms, request) => {
    const params = new URL(request.url).searchParams
    const archived = z.enum(['true', 'false']).parse(params.get('archived_only') ?? 'false')
    return rooms.listRooms(RoomListOptionsSchema.parse({ limit: params.has('limit') ? Number(params.get('limit')) : undefined,
      cursor: params.get('cursor') ?? undefined, archivedOnly: archived === 'true' }))
  })
  add('POST', '/v1/rooms', async (rooms, request) => rooms.service.create(await body(request)))
  add('GET', '/v1/rooms/:roomId', async (rooms, _request, context) => ({ room: await rooms.service.get(context.params.roomId) }))
  add('PATCH', '/v1/rooms/:roomId', async (rooms, request, context) => rooms.service.update(context.params.roomId, await body(request)))
  add('GET', '/v1/rooms/:roomId/messages', (rooms, request, context) => {
    const page = pagination(request)
    return rooms.messages(context.params.roomId, page.limit, page.cursor)
  })
  add('POST', '/v1/rooms/:roomId/messages', async (rooms, request, context) => rooms.service.send(context.params.roomId, await body(request)))
  add('GET', '/v1/rooms/:roomId/tasks', async (rooms, request, context) => {
    const roomId = context.params.roomId
    await rooms.service.get(roomId)
    const page = pagination(request)
    const selected = new URL(request.url).searchParams.get('status')
    const status = selected ? z.array(RoomTaskStatusSchema).parse(selected.split(',')) : undefined
    const rows = await rooms.deps.store.list<RoomTaskExecution>('task', {
      roomId, limit: page.limit, beforeSeq: page.cursor, status
    })
    return { tasks: rows.map((row) => ({ ...row.value.task, revision: row.revision })),
      nextCursor: rows.length === page.limit ? String(rows.at(-1)!.seq) : undefined }
  })
  add('GET', '/v1/rooms/:roomId/tasks/:taskId', (rooms, _request, context) =>
    rooms.taskDetail(context.params.roomId, context.params.taskId))
  for (const action of ['cancel', 'retry', 'accept', 'apply', 'review']) {
    add('POST', `/v1/rooms/:roomId/tasks/:taskId/${action}`, async (rooms, request, context) => {
      await rooms.action(context.params.roomId, context.params.taskId, action, await body(request))
      return rooms.taskDetail(context.params.roomId, context.params.taskId)
    })
  }
  add('GET', '/v1/rooms/:roomId/rules', async (rooms, _request, context) => {
    await rooms.service.get(context.params.roomId)
    return { rules: (await rooms.service.store.list('rule', { roomId: context.params.roomId, limit: 100 })).map((row) => row.value) }
  })
  add('POST', '/v1/rooms/:roomId/rules', async (rooms, request, context) => {
    const input = RoomRuleRequestSchema.parse(await body(request))
    const result = await rooms.service.rule(context.params.roomId, input.messageId, input.clientRequestId)
    return { rule: result.result }
  })
  add('GET', '/v1/rooms/:roomId/events', async (rooms, request, context) => {
    const roomId = context.params.roomId
    await rooms.service.get(roomId)
    const params = new URL(request.url).searchParams
    const since = z.coerce.number().int().nonnegative().parse(
      params.get('since_seq') ?? request.headers.get('last-event-id') ?? '0')
    if (request.headers.get('accept')?.includes('text/event-stream')) {
      return roomEventStream({ runtime, rooms, roomId, request, sinceSeq: since })
    }
    const events = await rooms.service.store.events(roomId, since, pagination(request).limit)
    return { events, cursor: events.at(-1)?.seq ?? since }
  })
}
