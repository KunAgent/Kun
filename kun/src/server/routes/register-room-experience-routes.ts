import { z } from 'zod'
import { RoomSearchQuerySchema, RoomRunSummaryQuerySchema } from '../../contracts/room-experience.js'
import { getRoomNotificationPreference, updateRoomNotificationPreference } from '../../rooms/room-notification-preferences.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'

type Add = (method: string, path: string, handler: (rooms: RoomRuntime,
  request: Request, context: RouteContext) => Promise<unknown> | unknown) => void
export function registerRoomExperienceRoutes(add: Add): void {
  add('GET', '/v1/rooms/search', async (rooms, request) => {
    const params = new URL(request.url).searchParams
    const input = RoomSearchQuerySchema.parse({ q: params.get('q'), kind: params.get('kind'),
      roomId: params.get('room_id') ?? undefined, repositoryRoot: params.get('repository_root') ?? undefined,
      cursor: params.get('cursor') ?? undefined, limit: params.has('limit') ? Number(params.get('limit')) : undefined,
      includeArchived: params.has('include_archived') ? z.enum(['true', 'false']).parse(params.get('include_archived')) === 'true' : false })
    return rooms.service.store.searchRooms(input)
  })
  add('GET', '/v1/rooms/repositories', async (rooms) => ({ repositories: await rooms.service.store.roomRepositories() }))
  add('GET', '/v1/rooms/:roomId/preferences', (rooms, _request, { params }) =>
    getRoomNotificationPreference(rooms.service.store, params.roomId))
  add('PUT', '/v1/rooms/:roomId/preferences', async (rooms, request, { params }) => {
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    return updateRoomNotificationPreference(rooms.service.store, params.roomId, body.value)
  })
  add('GET', '/v1/rooms/:roomId/run-summary', async (rooms, request, { params }) => {
    await rooms.service.get(params.roomId)
    const query = new URL(request.url).searchParams
    return rooms.service.store.runSummary(RoomRunSummaryQuerySchema.parse({ roomId: params.roomId,
      rootRequestId: query.get('root_request_id') ?? undefined, since: query.get('since') ?? undefined }))
  })
}
