import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'
import { RoomIdSchema } from '../../contracts/rooms.js'
import { RoomStoreConflictError } from '../../rooms/room-store.js'
import { cancelRoomReminder, listRoomReminders } from '../../rooms/room-reminders.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown) => void
async function body(request: Request) {
  const result = await readJsonBody(request)
  if (!result.ok) throw new z.ZodError([{ code: 'custom', path: [], message: 'invalid reminder request body' }])
  return result.value
}
/** Reminders only exist inside private user-agent conversations. */
async function privateRoom(rooms: RoomRuntime, roomId: string) {
  const room = await rooms.service.get(roomId)
  if (room.conversationKind !== 'user_agent') {
    throw new RoomStoreConflictError('reminders are only available in private agent conversations')
  }
  return room
}

/**
 * User-facing reminder surface: listing is read-only and cancellation is a
 * user-scoped mutation that always records `user_cancelled`. Agents manage
 * reminders only through their own conversation tools.
 */
export function registerRoomReminderRoutes(add: Add): void {
  add('GET', '/v1/rooms/:roomId/reminders', async (rooms, request, { params }) => {
    const status = z.enum(['scheduled', 'all']).default('all')
      .parse(new URL(request.url).searchParams.get('status') ?? undefined)
    await privateRoom(rooms, params.roomId)
    return { reminders: await listRoomReminders(rooms.deps.store, params.roomId, { status }) }
  })
  add('POST', '/v1/rooms/:roomId/reminders/:reminderId/cancel', async (rooms, request, { params }) => {
    const input = z.object({ clientRequestId: RoomIdSchema,
      expectedRevision: z.number().int().nonnegative().optional() }).strict().parse(await body(request))
    await privateRoom(rooms, params.roomId)
    return rooms.exclusive(() => cancelRoomReminder(rooms.deps.store, params.roomId,
      RoomIdSchema.parse(params.reminderId), {
        clientRequestId: input.clientRequestId,
        reason: 'user_cancelled',
        ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}) }))
  })
}
