import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../../domain/thread.js'
import { RoomMessageSchema, type RoomMessage } from '../../contracts/rooms.js'
import { RoomRunRecordSchema } from '../../contracts/room-runs.js'
import { RoomService, putRoomDocument } from '../../rooms/room-service.js'
import { SqliteRoomStore } from '../../rooms/room-store-sqlite.js'
import { setRoomAppConnectionStatus } from '../../rooms/room-app-connections.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import { bindRoomContinuationDispatcher } from '../../rooms/room-continuation-dispatch.js'
import { registerRoomImConnectionRoutes } from './register-room-im-connection-routes.js'
import type { RoomRequestState } from '../../rooms/room-runtime-types.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture(serverId = 'im.feishu') {
  const directory = await mkdtemp(join(tmpdir(), 'room-app-route-'))
  const store = new SqliteRoomStore({ path: join(directory, 'rooms.sqlite') })
  const service = new RoomService(store, () => {})
  const member = { id: 'agent-member', displayName: 'Bot', participantAgentId: 'agent-1',
    presetId: 'general', role: 'developer' as const, roleNotes: '', enabled: true,
    revision: 0, allowedRepositoryIds: [] }
  const room = (await service.create({ clientRequestId: 'create-room', name: 'Bot', members: [member] },
    { id: 'private-room', conversationKind: 'user_agent' })).room
  const threads = new InMemoryThreadStore()
  await threads.upsert(createThreadRecord({ id: 'conv-thread', title: 'Bot', workspace: directory, model: 'test',
    roomContext: { roomId: room.id, memberId: member.id, participantAgentId: 'agent-1', kind: 'conversation',
      blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] } }))
  const now = new Date().toISOString()
  await putRoomDocument(store, 'room_run', 'run-1', room.id, RoomRunRecordSchema.parse({
    id: 'run-1', roomId: room.id, memberId: member.id, memberLabel: 'Bot', phase: 'conversation',
    attempt: 1, clientRequestId: 'request-1', threadId: 'conv-thread', turnId: 'turn-1', input: 'Gmail',
    attachmentIds: [], status: 'completed', createdAt: now, updatedAt: now
  }), null)
  await putRoomDocument(store, 'message', 'card-1', room.id, RoomMessageSchema.parse({
    id: 'card-1', roomId: room.id, messageSeq: 1, authorKind: 'member', authorMemberId: member.id,
    authorLabelSnapshot: 'Bot', originRunId: 'run-1', presentationKind: 'app_connection',
    appConnection: { serverId, status: 'requested', resumed: false },
    body: 'I need an app.', bodyRevision: 0, mentionMemberIds: [], attachmentIds: [],
    status: 'final', createdAt: now
  }), null)

  const handlers = new Map<string, (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown>()
  registerRoomImConnectionRoutes((method, path, handler) => handlers.set(method + ' ' + path, handler))
  let locked = false
  const exclusive = async (action: () => Promise<unknown>) => {
    if (locked) throw new Error('nested exclusive would deadlock the real coordinator')
    locked = true
    try { return await action() } finally { locked = false }
  }
  const unbind = bindRoomContinuationDispatcher(threads, async () => { await exclusive(async () => {}); return 'queued' })
  const approvals = { pending: vi.fn(() => []) }, inputs = { pending: vi.fn(() => []) }
  const rooms = { service, deps: { store, threadStore: threads, approvals, inputs },
    exclusive } as unknown as RoomRuntime
  const call = (suffix: string, data?: unknown, extra: Record<string, string> = {}, query = '') => {
    const method = data === undefined ? 'GET' : 'POST'
    return handlers.get(method + ' /v1/rooms/:roomId/' + suffix)!(rooms,
      new Request('http://localhost/' + query, { method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }),
      { params: { roomId: room.id, messageId: 'card-1', connectionId: 'connection-1', ...extra } } as RouteContext)
  }
  const connect = () => call('im-cards/:messageId/complete', { connectionId: 'connection-1', ownerId: 'owner-1' })
  const send = (overrides = {}) => call('im-connections/:connectionId/messages', {
    senderId: 'owner-1', chatId: 'dm-1', messageId: 'event-1', text: 'Do this task', ...overrides })
  cleanup.push(async () => { unbind(); await store.close(); await rm(directory, { recursive: true, force: true }) })
  return { store, service, room, call, connect, send, approvals, inputs }
}

describe('private Agent IM runtime boundary', () => {
  it('binds the existing private identity without creating another Agent or conversation', async () => {
    const f = await fixture()
    expect(await f.call('im-cards/:messageId')).toMatchObject({ agentId: 'agent-1', provider: 'feishu', status: 'requested' })
    await f.connect()
    expect((await f.store.get('agent_im_connection', 'connection-1'))?.value).toMatchObject({ agentId: 'agent-1', roomId: f.room.id, ownerId: 'owner-1' })
    expect(await f.store.list('room')).toHaveLength(1)
    await expect(f.connect()).resolves.toMatchObject({ connectionId: 'connection-1' })
    await expect(f.call('im-cards/:messageId/complete', { connectionId: 'connection-1', ownerId: 'attacker' })).rejects.toThrow('identity changed')
  })
  it('rejects unknown sender, unpaired and disconnected commands', async () => {
    const f = await fixture()
    await expect(f.send()).rejects.toThrow('not found')
    await f.connect()
    await expect(f.send({ senderId: 'attacker' })).rejects.toThrow('verified connection owner')
    await f.call('im-connections/:connectionId/disconnect', {})
    await expect(f.send()).rejects.toThrow('disconnected')
    expect(await f.store.list('request')).toHaveLength(0)
  })
  it('durably deduplicates exact provider event identity and preserves IM surface', async () => {
    const f = await fixture(); await f.connect()
    const first = await f.send() as { requestId: string }
    expect(await f.send()).toEqual(first)
    const request = (await f.store.get<RoomRequestState>('request', first.requestId))!.value
    expect(request).toMatchObject({ roomId: f.room.id, clientSurface: 'im', imConnectionId: 'connection-1', privateProtocol: 'direct-v1' })
    expect(request.roomSnapshot.members[0].participantAgentId).toBe('agent-1')
    expect(await f.store.list('request')).toHaveLength(1)
    await expect(f.send({ text: 'changed replay' })).rejects.toThrow()
  })
  it('refuses a skipped card and archived Agent instead of expanding access', async () => {
    const f = await fixture()
    await setRoomAppConnectionStatus(f.store, f.room.id, 'card-1', 'skipped')
    await expect(f.connect()).rejects.toThrow('already resolved')
  })
  it('keeps GUI-only topics and other connection replies out of remote delivery', async () => {
    const f = await fixture(); await f.connect()
    const own = await f.send() as { requestId: string }
    const now = new Date().toISOString()
    for (const [id, root] of [['im-reply', own.requestId], ['private-gui', 'gui-request']] as const) {
      await putRoomDocument(f.store, 'message', id, f.room.id, RoomMessageSchema.parse({ id, roomId: f.room.id,
        rootRequestId: root, authorKind: 'member', authorMemberId: 'agent-member', authorLabelSnapshot: 'Bot',
        messageSeq: 1, mentionMemberIds: [], attachmentIds: [], body: id, bodyRevision: 0, status: 'final', createdAt: now }), null)
    }
    const result = await f.call('im-connections/:connectionId/delivery', undefined, {}, '?cursor=0') as { messages: Array<{ id: string }> }
    expect(result.messages.map((message) => message.id)).toEqual(['im-reply'])
  })
  it('isolates two IM connections sharing a private room, including later background results', async () => {
    const f = await fixture(); await f.connect()
    const first = await f.send() as { requestId: string }
    const original = (await f.store.get<RoomMessage>('message', 'card-1'))!.value
    await putRoomDocument(f.store, 'message', 'card-2', f.room.id, { ...original, id: 'card-2',
      appConnection: { serverId: 'im.feishu', status: 'requested', resumed: false } }, null)
    await f.call('im-cards/:messageId/complete', { connectionId: 'connection-2', ownerId: 'owner-2' }, { messageId: 'card-2' })
    const second = await f.call('im-connections/:connectionId/messages', { senderId: 'owner-2', chatId: 'dm-2', messageId: 'event-2', text: 'Second task' }, { connectionId: 'connection-2' }) as { requestId: string }
    const gui = await f.service.send(f.room.id, { clientRequestId: 'gui-only', body: 'Private desktop task' })
    const now = new Date().toISOString()
    for (const [id, root] of [['first-reply', first.requestId], ['second-reply', second.requestId], ['gui-reply', gui.requestId]] as const) {
      await putRoomDocument(f.store, 'message', id, f.room.id, RoomMessageSchema.parse({ id, roomId: f.room.id, rootRequestId: root,
        messageSeq: 1, authorKind: 'member', authorLabelSnapshot: 'Bot', mentionMemberIds: [], attachmentIds: [],
        body: id, bodyRevision: 0, status: 'final', createdAt: now }), null)
    }
    const page = await f.call('im-connections/:connectionId/delivery', undefined, {}, '?cursor=0') as { messages: Array<{ id: string }>; cursor: number }
    expect(page.messages.map((item) => item.id)).toEqual(['first-reply'])
    const other = await f.call('im-connections/:connectionId/delivery', undefined, { connectionId: 'connection-2' }, '?cursor=0') as typeof page
    expect(other.messages.map((item) => item.id)).toEqual(['second-reply'])
    await putRoomDocument(f.store, 'message', 'background-result', f.room.id, RoomMessageSchema.parse({ id: 'background-result', roomId: f.room.id,
      rootRequestId: first.requestId, sourceRequestId: 'later-continuation', messageSeq: 1, authorKind: 'member', authorLabelSnapshot: 'Bot',
      mentionMemberIds: [], attachmentIds: [], body: 'Worker finished later', bodyRevision: 0, status: 'final', createdAt: now }), null)
    const later = await f.call('im-connections/:connectionId/delivery', undefined, {}, '?cursor=' + page.cursor) as typeof page
    expect(later.messages.map((item) => item.id)).toEqual(['background-result'])
  })

  it('reports scan pagination separately from the filtered output count', async () => {
    const f = await fixture(); await f.connect()
    const now = new Date().toISOString()
    for (let i = 0; i < 105; i++) await putRoomDocument(f.store, 'message', 'unrelated-' + i, f.room.id,
      RoomMessageSchema.parse({ id: 'unrelated-' + i, roomId: f.room.id, authorKind: 'user', authorLabelSnapshot: 'You',
        messageSeq: 1, mentionMemberIds: [], attachmentIds: [], body: 'private local text', bodyRevision: 0, status: 'final', createdAt: now }), null)
    const first = await f.call('im-connections/:connectionId/delivery', undefined, {}, '?cursor=0') as { hasMore: boolean; cursor: number; messages: unknown[] }
    expect(first).toMatchObject({ hasMore: true, messages: [] })
    expect(first.cursor).toBeGreaterThan(0)
    const next = await f.call('im-connections/:connectionId/delivery', undefined, {}, '?cursor=' + first.cursor)
    expect(next).toMatchObject({ hasMore: false, messages: [] })
  })
})
