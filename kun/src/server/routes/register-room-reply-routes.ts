import { z } from 'zod'
import { RoomIdSchema } from '../../contracts/rooms.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime,
  request: Request, context: RouteContext) => Promise<unknown> | unknown) => void

export function registerRoomReplyRoutes(add: Add): void {
  add('GET', '/v1/rooms/:roomId/replies/:messageId', async (rooms, request, { params }) => {
    await rooms.service.get(params.roomId)
    const input = z.object({ limit: z.coerce.number().int().min(1).max(100).default(40),
      cursor: z.coerce.number().int().nonnegative().optional() }).strict()
      .parse(Object.fromEntries(new URL(request.url).searchParams))
    return rooms.service.store.replyPage({ roomId: params.roomId,
      messageId: RoomIdSchema.parse(params.messageId), beforeSeq: input.cursor, limit: input.limit })
  })
}
