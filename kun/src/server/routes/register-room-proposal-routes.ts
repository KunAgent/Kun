import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'
import { RoomIdSchema } from '../../contracts/rooms.js'
import { readRoomProposal, resolveRoomProposal } from '../../rooms/room-proposals.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown) => void
async function body(request: Request) {
  const result = await readJsonBody(request)
  if (!result.ok) throw new z.ZodError([{ code: 'custom', path: [], message: 'invalid proposal request body' }])
  return result.value
}

/**
 * Proposal cards are read here and resolved here. Creation only happens inside
 * the agent tool; adoption stays an explicit user request to this route.
 */
export function registerRoomProposalRoutes(add: Add): void {
  add('GET', '/v1/rooms/:roomId/proposals/:proposalId', (rooms, _request, { params }) =>
    readRoomProposal(rooms.deps.store, params.roomId, RoomIdSchema.parse(params.proposalId)))
  add('POST', '/v1/rooms/:roomId/proposals/:proposalId/resolve', async (rooms, request, { params }) => {
    const input = await body(request)
    try {
      return await rooms.exclusive(() => resolveRoomProposal(rooms.deps.store, params.roomId, RoomIdSchema.parse(params.proposalId), input))
    } finally { rooms.wake() }
  })
}
