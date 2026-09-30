import { z } from 'zod'
import { RoomIdSchema, type RoomMessage } from '../../contracts/rooms.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown>) => void
/** Auth and room-id validation are supplied by the shared room route wrapper. */
export function registerRoomMessageContextRoutes(add: Add) {
  add('GET', '/v1/rooms/:roomId/messages/:messageId/context', async (rooms, request, { params }) => {
    await rooms.service.get(params.roomId)
    const target = await rooms.deps.store.get<RoomMessage>('message', RoomIdSchema.parse(params.messageId))
    if (!target || target.roomId !== params.roomId) throw new Error('message not found')
    const limit = z.coerce.number().int().min(1).max(50).parse(new URL(request.url).searchParams.get('limit') ?? 20)
    const [before, after] = await Promise.all([
      rooms.deps.store.list<RoomMessage>('message', { roomId: params.roomId, beforeSeq: target.seq, limit, order: 'desc' }),
      rooms.deps.store.list<RoomMessage>('message', { roomId: params.roomId, afterSeq: target.seq, limit, order: 'asc' })
    ])
    return { targetMessageId: target.id,
      messages: [...before.reverse(), target, ...after].filter((row) => row.value.presentationKind !== 'setup')
        .map((row) => ({ ...row.value, messageSeq: row.seq })),
      hasEarlier: before.length === limit, hasLater: after.length === limit }
  })
  add('GET', '/v1/rooms/:roomId/read', async (rooms, _request, { params }) => {
    await rooms.service.get(params.roomId)
    const seq = (await rooms.deps.store.get<{ seq: number }>('read_state', params.roomId))?.value.seq ?? 0
    let afterSeq = seq
    for (;;) {
      const page = await rooms.deps.store.list<RoomMessage>('message', { roomId: params.roomId, afterSeq, order: 'asc', limit: 100 })
      const first = page.find((row) => row.value.presentationKind !== 'setup' && row.value.status !== 'streaming')
      if (first) return { seq, firstUnreadMessageId: first.id }
      if (page.length < 100) return { seq }
      afterSeq = page.at(-1)!.seq
    }
  })
}
