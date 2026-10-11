import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import { roomResultInboxPage } from '../../rooms/room-result-inbox.js'

type Add = (method: string, path: string,
  handler: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown>) => void

export function registerRoomResultInboxRoutes(add: Add) {
  add('GET', '/v1/rooms/:roomId/result-inbox', async (rooms, request, { params }) => {
    await rooms.service.get(params.roomId)
    const query = new URL(request.url).searchParams
    const limit = z.coerce.number().int().min(1).max(200).parse(query.get('limit') ?? 50)
    const cursor = query.has('cursor') ? z.coerce.number().int().nonnegative().parse(query.get('cursor')) : undefined
    return roomResultInboxPage(rooms.deps.store, params.roomId, limit, cursor)
  })
}
