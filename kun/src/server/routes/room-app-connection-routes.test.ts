import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../../domain/thread.js'
import { McpCapabilityConfig } from '../../contracts/capabilities.js'
import { RoomMessageSchema, type RoomMessage } from '../../contracts/rooms.js'
import { RoomRunRecordSchema } from '../../contracts/room-runs.js'
import { RoomService, putRoomDocument } from '../../rooms/room-service.js'
import { SqliteRoomStore } from '../../rooms/room-store-sqlite.js'
import { bindRoomContinuationDispatcher } from '../../rooms/room-continuation-dispatch.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { registerRoomAppConnectionRoutes } from './register-room-app-connection-routes.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture() {
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
    appConnection: { serverId: 'google_gmail', status: 'requested', resumed: false },
    body: 'I need Gmail.', bodyRevision: 0, mentionMemberIds: [], attachmentIds: [],
    status: 'final', createdAt: now
  }), null)
  const dispatch = vi.fn(async () => 'queued' as const)
  const unbind = bindRoomContinuationDispatcher(threads, dispatch)
  let authorized = false, connected = false
  const runtime = { mcpConfig: () => McpCapabilityConfig.parse({ enabled: true, servers: {
    google_gmail: { transport: 'streamable-http', url: 'https://gmailmcp.googleapis.com/mcp/v1', trustScope: 'user', oauth: {} }
  } }), mcpOAuth: async () => [{ serverId: 'google_gmail', status: authorized ? 'authorized' : 'empty' }],
  toolDiagnostics: async () => ({ mcpServers: [{ id: 'google_gmail', status: connected ? 'connected' : 'authorization_required' }] }) } as unknown as ServerRuntime
  const handlers = new Map<string, (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown>()
  registerRoomAppConnectionRoutes((method, path, handler) => handlers.set(method + ' ' + path, handler), runtime)
  const rooms = { service, deps: { store, threadStore: threads }, exclusive: async (action: () => Promise<unknown>) => action() } as unknown as RoomRuntime
  const call = (action: 'complete' | 'skip') => handlers.get(`POST /v1/rooms/:roomId/app-connections/:messageId/${action}`)!(
    rooms, new Request('http://localhost', { method: 'POST', body: JSON.stringify({ clientRequestId: 'action-1' }) }),
    { params: { roomId: room.id, messageId: 'card-1' } } as RouteContext)
  cleanup.push(async () => { unbind(); await store.close(); await rm(directory, { recursive: true, force: true }) })
  return { store, room, dispatch, call, authorize: () => { authorized = true }, connect: () => { connected = true } }
}

describe('Room app connection resolution', () => {
  it('requires actual OAuth and tool connectivity before continuing once', async () => {
    const f = await fixture()
    await expect(f.call('complete')).rejects.toThrow('authorization has not completed')
    f.authorize()
    await expect(f.call('complete')).rejects.toThrow('tools are not connected')
    expect((await f.store.get<RoomMessage>('message', 'card-1'))!.value.appConnection?.status).toBe('requested')
    f.connect()
    const result = await f.call('complete') as { message: RoomMessage; resumed: boolean }
    expect(result).toMatchObject({ resumed: true, message: { appConnection: { status: 'connected', resumed: true } } })
    expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({ kind: 'app_connection', sourceTurnId: 'turn-1', key: 'card-1' }))
    await f.call('complete')
    expect(f.dispatch).toHaveBeenCalledTimes(1)
  })

  it('lets the user skip and continues without app access', async () => {
    const f = await fixture()
    const result = await f.call('skip') as { message: RoomMessage; resumed: boolean }
    expect(result.message.appConnection).toMatchObject({ status: 'skipped', resumed: true })
    expect(f.dispatch).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('skipped connecting') }))
  })
})
