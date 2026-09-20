import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'
import { ParticipantAgentId } from '../../contracts/agent-identities.js'
import type { AgentHandoff } from '../../contracts/agent-handoffs.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown) => void
const Page = z.object({ source_room_id: ParticipantAgentId.optional(), pair_room_id: ParticipantAgentId.optional(),
  root_request_id: ParticipantAgentId.optional(), cursor: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20) }).strict()
async function body(request: Request) {
  const value = await readJsonBody(request)
  if (!value.ok) throw new Error('invalid handoff request')
  return value.value
}
export function registerAgentHandoffRoutes(add: Add) {
  add('GET', '/v1/agent-handoffs', async (rooms, request) => {
    const input = Page.parse(Object.fromEntries(new URL(request.url).searchParams))
    if (!input.source_room_id && !input.pair_room_id) throw new Error('a source or pair conversation is required')
    await rooms.service.get(input.source_room_id ?? input.pair_room_id!)
    const rows = await rooms.deps.store.list<AgentHandoff>('agent_handoff', {
      sourceRoomId: input.source_room_id, roomId: input.pair_room_id, rootRequestId: input.root_request_id,
      beforeSeq: input.cursor, limit: input.limit + 1, summaryOnly: true })
    return { handoffs: rows.slice(0, input.limit).map((row) => ({ id: row.id, revision: row.revision,
      sourceRoomId: row.value.sourceRoomId, sourceRootRequestId: row.value.sourceRootRequestId,
      pairRoomId: row.value.pairRoomId, parentHandoffId: row.value.parentHandoffId,
      senderAgentId: row.value.senderAgentId, recipientAgentId: row.value.recipientAgentId,
      recipientName: row.value.recipientSnapshot.displayName, status: row.value.status,
      runId: row.value.runId, phase: row.value.phase, attempt: row.value.attempt,
      waitingReason: row.value.waitingReason, error: row.value.error, createdAt: row.value.createdAt })),
      nextCursor: rows.length > input.limit ? String(rows[input.limit - 1].seq) : undefined }
  })
  add('POST', '/v1/agent-handoffs', async (rooms, request) => {
    const input = await body(request)
    return rooms.exclusive(() => rooms.handoffs.create(input))
  })
  add('GET', '/v1/agent-handoffs/:handoffId', async (rooms, _request, { params }) => {
    const id = ParticipantAgentId.parse(params.handoffId)
    const row = await rooms.deps.store.get<AgentHandoff>('agent_handoff', id)
    if (!row) throw new Error('agent handoff not found')
    return { handoff: row.value, revision: row.revision }
  })
  for (const action of ['cancel', 'retry'] as const) add('POST', '/v1/agent-handoffs/:handoffId/' + action, async (rooms, request, { params }) => {
    const id = ParticipantAgentId.parse(params.handoffId)
    const input = z.object({ clientRequestId: ParticipantAgentId, expectedRevision: z.number().int().nonnegative() }).strict().parse(await body(request))
    return rooms.exclusive(() => rooms.handoffs.action(id, action, input))
  })
}
