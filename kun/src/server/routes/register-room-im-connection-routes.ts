import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import { RoomIdSchema, type RoomMessage } from '../../contracts/rooms.js'
import type { RoomRequestState } from '../../rooms/room-runtime-types.js'
import { RoomStoreConflictError } from '../../rooms/room-store.js'
import { imConnectionCard, activeImConnection, type AgentImConnection } from '../../rooms/room-im-connections.js'
import { dispatchRoomContinuation } from '../../rooms/room-continuation-dispatch.js'
import { markRoomAppConnectionResumed, setRoomAppConnectionStatus } from '../../rooms/room-app-connections.js'
import type { RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown) => void
async function body(request: Request) {
  const result = await readJsonBody(request)
  if (!result.ok) throw new Error('Invalid IM request')
  return result.value
}
const route = '/v1/rooms/:roomId/im-connections/:connectionId'

/** Host-only integration over the same authenticated local runtime boundary; no public provider webhook. */
export function registerRoomImConnectionRoutes(add: Add): void {
  add('GET', '/v1/rooms/:roomId/im-cards/:messageId', async (rooms, _request, { params }) => {
    const card = await imConnectionCard(rooms, params.roomId, RoomIdSchema.parse(params.messageId))
    return { agentId: card.agentId, name: card.member.displayName, provider: card.provider,
      status: card.row.value.appConnection!.status }
  })
  add('POST', '/v1/rooms/:roomId/im-cards/:messageId/complete', async (rooms, request, { params }) => {
    const input = z.object({ connectionId: RoomIdSchema, ownerId: z.string().trim().min(1).max(256) }).strict().parse(await body(request))
    const resolved = await rooms.exclusive(async () => {
      const card = await imConnectionCard(rooms, params.roomId, RoomIdSchema.parse(params.messageId))
      const current = await rooms.deps.store.get<AgentImConnection>('agent_im_connection', input.connectionId)
      if (current) {
        if (current.value.cardId !== params.messageId || current.value.ownerId !== input.ownerId ||
            current.value.roomId !== params.roomId || !current.value.enabled) throw new RoomStoreConflictError('IM connection identity changed')
      } else {
        if (card.row.value.appConnection!.status !== 'requested') throw new RoomStoreConflictError('IM card already resolved')
        const value: AgentImConnection = { id: input.connectionId, roomId: params.roomId, agentId: card.agentId,
          cardId: params.messageId, provider: card.provider, ownerId: input.ownerId, enabled: true, createdAt: new Date().toISOString() }
        await rooms.deps.store.commit({ requestId: 'im-connect:' + input.connectionId,
          checks: [{ kind: 'agent_im_connection', id: input.connectionId, expectedRevision: null }],
          puts: [{ kind: 'agent_im_connection', id: input.connectionId, roomId: params.roomId, value }],
          events: [{ roomId: params.roomId, kind: 'im.connected', payload: { id: input.connectionId, provider: card.provider } }] })
      }
      const message = await setRoomAppConnectionStatus(rooms.deps.store, params.roomId, params.messageId, 'connected')
      return { message, card }
    })
    // The dispatcher acquires the same queue; never invoke it while holding exclusive.
    let { message } = resolved
    const { card } = resolved
    if (!message.appConnection?.resumed) {
        const outcome = await dispatchRoomContinuation(rooms.deps.threadStore, {
          threadId: card.run.value.threadId!, sourceTurnId: card.run.value.turnId!, kind: 'app_connection', key: params.messageId,
          prompt: `The user connected ${card.provider} to this Agent through official authorization. Only the verified owner can send private messages. The desktop must stay open; approvals and files remain in Kun. Continue the original task without repeating completed actions.` })
        if (outcome === 'queued') message = await rooms.exclusive(() => markRoomAppConnectionResumed(rooms.deps.store, params.roomId, params.messageId))
      }
    return { message, connectionId: input.connectionId }
  })
  add('POST', route + '/disconnect', async (rooms, _request, { params }) => rooms.exclusive(async () => {
    const row = await rooms.deps.store.get<AgentImConnection>('agent_im_connection', params.connectionId)
    if (!row || row.roomId !== params.roomId) throw new RoomStoreConflictError('IM connection not found')
    if (row.value.enabled) await rooms.deps.store.commit({ requestId: randomUUID(),
      checks: [{ kind: 'agent_im_connection', id: row.id, expectedRevision: row.revision }],
      puts: [{ kind: 'agent_im_connection', id: row.id, roomId: params.roomId,
        value: { ...row.value, enabled: false, disconnectedAt: new Date().toISOString() } }],
      events: [{ roomId: params.roomId, kind: 'im.disconnected', payload: { id: row.id } }] })
    return { disconnected: true }
  }))
  add('POST', route + '/messages', async (rooms, request, { params }) => {
    const input = z.object({ senderId: z.string().min(1).max(256), chatId: z.string().min(1).max(256),
      messageId: z.string().min(1).max(256), text: z.string().trim().min(1).max(16000) }).strict().parse(await body(request))
    return rooms.exclusive(async () => {
      const { value } = await activeImConnection(rooms, params.roomId, params.connectionId)
      if (input.senderId !== value.ownerId) throw new RoomStoreConflictError('Only the verified connection owner can send commands')
      const clientRequestId = 'im-' + createHash('sha256').update(JSON.stringify([value.id, input.senderId, input.chatId, input.messageId])).digest('hex')
      return rooms.service.send(params.roomId, { clientRequestId, body: input.text }, { clientSurface: 'im', imConnectionId: value.id })
    })
  })
  add('GET', route + '/delivery', async (rooms, request, { params }) => {
    await activeImConnection(rooms, params.roomId, params.connectionId)
    const query = new URL(request.url).searchParams
    const cursor = z.coerce.number().int().nonnegative().parse(query.get('cursor') ?? 0)
    const rows = await rooms.deps.store.list<RoomMessage>('message', { roomId: params.roomId,
      afterSeq: cursor, order: 'asc', limit: 100 })
    const messages: Array<{ id: string; text: string; hasAttachments: boolean; seq: number }> = []
    for (const entry of rows) {
      if (entry.value.authorKind !== 'member' || entry.value.status !== 'final' || !entry.value.rootRequestId) continue
      const root = await rooms.deps.store.get<RoomRequestState>('request', entry.value.rootRequestId)
      // Only replies owed to this IM connection can leave the desktop; GUI-only topics never do.
      if (!root || root.roomId !== params.roomId || root.value.imConnectionId !== params.connectionId) continue
      const presentation = entry.value.presentationKind
      if (presentation === 'setup') continue
      const text = presentation === 'app_connection'
        ? 'Your Agent has a connection request. Open Kun to review it and continue official authorization; no new access has been granted.'
        : presentation ? 'Your Agent has a task card or decision for you. Open this conversation in Kun to review it.' : entry.value.body
      messages.push({ id: entry.id, text,
        hasAttachments: entry.value.attachmentIds.length > 0 || Boolean(entry.value.references?.length), seq: entry.seq })
    }
    const attention: string[] = []
    const requests = await rooms.deps.store.list<RoomRequestState>('request', { roomId: params.roomId,
      status: ['pending', 'running', 'needs_input'], limit: 1000 })
    for (const item of requests) {
      if (item.value.imConnectionId !== params.connectionId) continue
      for (const approval of rooms.deps.approvals.pending(item.value.threadId)) {
        if (approval.turnId === item.value.turnId) attention.push('approval:' + approval.id)
      }
      for (const input of rooms.deps.inputs.pending(item.value.threadId)) {
        if (input.turnId === item.value.turnId) attention.push('input:' + input.id)
      }
      if (item.value.status === 'needs_input') attention.push('request:' + item.id)
    }
    return { messages, cursor: rows.at(-1)?.seq ?? cursor, hasMore: rows.length === 100, attention }
  })
}
