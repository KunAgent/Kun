import { z } from 'zod'
import { submitRoomPollAction } from '../../rooms/room-poll-actions.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'
import { RoomIdSchema } from '../../contracts/rooms.js'
import { createRoomPoll, commitRoomPollVote, closeRoomPoll, readRoomPoll } from '../../rooms/room-polls.js'
import { readRoomMessageInteractions, setRoomMessageReaction } from '../../rooms/room-interactions.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown) => void
async function body(request: Request) { const result = await readJsonBody(request); if (!result.ok) throw new z.ZodError([{ code: 'custom', path: [], message: 'invalid interaction request body' }]); return result.value }
const id = (value: string) => RoomIdSchema.parse(value)
export function registerRoomInteractionRoutes(add: Add): void {
  add('GET', '/v1/rooms/:roomId/messages/:messageId/interactions', (rooms, _request, { params }) =>
    readRoomMessageInteractions(rooms.deps.store, params.roomId, id(params.messageId)))
  add('PUT', '/v1/rooms/:roomId/messages/:messageId/reactions', async (rooms, request, { params }) => {
    const input = await body(request)
    return rooms.exclusive(() => setRoomMessageReaction(rooms.deps.store, params.roomId, id(params.messageId), input))
  })
  add('POST', '/v1/rooms/:roomId/polls', async (rooms, request, { params }) => {
    const input = await body(request)
    return rooms.exclusive(() => createRoomPoll(rooms.deps.store, params.roomId, input))
  })
  add('GET', '/v1/rooms/:roomId/polls/:pollId', (rooms, _request, { params }) => readRoomPoll(rooms.deps.store, params.roomId, id(params.pollId)))
  add('PUT', '/v1/rooms/:roomId/polls/:pollId/vote', async (rooms, request, { params }) => {
    const input = await body(request)
    return rooms.exclusive(() => commitRoomPollVote(rooms.deps.store, params.roomId, id(params.pollId), input))
  })
  add('POST', '/v1/rooms/:roomId/polls/:pollId/close', async (rooms, request, { params }) => {
    const input = await body(request)
    return rooms.exclusive(() => closeRoomPoll(rooms.deps.store, params.roomId, id(params.pollId), input))
  })
  for (const action of ['invite', 'discuss'] as const) add('POST', `/v1/rooms/:roomId/polls/:pollId/${action}`, async (rooms, request, { params }) => {
    const input = await body(request)
    return rooms.exclusive(() => submitRoomPollAction({ store: rooms.deps.store, service: rooms.service }, params.roomId, id(params.pollId), action, input))
  })
}
