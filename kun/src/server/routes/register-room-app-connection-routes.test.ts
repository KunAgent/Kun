import { LOCAL_GMAIL_RECIPIENT } from '../../contracts/gmail.js'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../../domain/thread.js'
import { createTurnRecord } from '../../domain/turn.js'
import { GMAIL_SCOPES, type GmailServicePort } from '../../gmail/ports.js'
import { bindRoomContinuationDispatcher } from '../../rooms/room-continuation-dispatch.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { registerRoomAppConnectionRoutes } from './register-room-app-connection-routes.js'

async function fixture() {
  const threads = new InMemoryThreadStore()
  await threads.upsert(createThreadRecord({ id: 'room-thread', title: 'Agent', workspace: '/tmp', model: 'model',
    roomContext: { roomId: 'room-1', kind: 'conversation', memberId: 'member-1', participantAgentId: 'agent-1',
      blockedProviderIds: [], blockedToolNames: [], blockedSkillIds: [] } }))
  const stored = (await threads.get('room-thread'))!
  stored.turns.push(createTurnRecord({ id: 'turn-1', threadId: stored.id, prompt: 'Connect Gmail',
    model: 'admitted-model', providerId: 'admitted-provider', status: 'completed' }))
  await threads.upsert(stored)
  const policy = { availability: vi.fn(async () => ({ allowed: true, recipient: 'kun-managed-local' as const, recipientBinding: LOCAL_GMAIL_RECIPIENT, consentId: 'local-proof' })), assertAllowed: vi.fn(async () => {}) }
  const room = { id: 'room-1', conversationKind: 'user_agent', members: [{ id: 'member-1', enabled: true,
    participantAgentId: 'agent-1' }] }
  const rows = new Map<string, { id: string; roomId: string; revision: number; value: Record<string, unknown> }>([
    ['card-1', { id: 'card-1', roomId: 'room-1', revision: 0, value: {
      id: 'card-1', roomId: 'room-1', bodyRevision: 0, authorKind: 'member', authorMemberId: 'member-1',
      presentationKind: 'app_connection', originRunId: 'run-1',
      appConnection: { serverId: 'google_gmail', status: 'requested', resumed: false }
    } }], ['run-1', { id: 'run-1', roomId: 'room-1', revision: 0, value: {
      phase: 'conversation', memberId: 'member-1', participantAgentId: 'agent-1', threadId: 'room-thread', turnId: 'turn-1'
    } }]
  ])
  const continuation = vi.fn(async () => 'queued' as const)
  bindRoomContinuationDispatcher(threads, continuation)
  const rooms = { service: { get: vi.fn(async () => room) }, exclusive: async (fn: () => Promise<unknown>) => fn(),
    deps: { threadStore: threads, store: { get: async (_kind: string, id: string) => rows.get(id),
      list: async () => [],
      commit: async (commit: { puts: Array<{ id: string; roomId: string; value: Record<string, unknown> }> }) => {
        for (const put of commit.puts) rows.set(put.id, { ...put, revision: (rows.get(put.id)?.revision ?? -1) + 1 })
      } } } } as unknown as RoomRuntime
  const status = { configured: true, connected: true, reconnectRequired: false,
    scopes: [...GMAIL_SCOPES], allowModelSharing: true }
  const gmail = { status: vi.fn(async () => status), hasGoogleData: vi.fn(async () => false) } as unknown as GmailServicePort
  const runtime = { gmail, gmailDataPolicy: policy, rooms, threadService: { get: (id: string) => threads.get(id) } } as unknown as ServerRuntime
  type Handler = (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown
  const routes = new Map<string, Handler>()
  registerRoomAppConnectionRoutes((method, path, handler) => routes.set(method + ' ' + path, handler), runtime)
  const request = (action = 'complete') => routes.get(`POST /v1/rooms/:roomId/app-connections/:messageId/${action}`)!(
    rooms, new Request('http://localhost/', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientRequestId: 'complete-1' }) }), { params: { roomId: 'room-1', messageId: 'card-1' } })
  return { request, rooms, rows, status, gmail, policy, continuation, threads, room, runtime }
}

describe('native Gmail private Agent continuation', () => {
  it('continues the original task only after actual Google authorization and conversation model consent', async () => {
    const f = await fixture()
    expect(await f.request()).toMatchObject({ message: { appConnection: { status: 'connected', resumed: true } }, resumed: true })
    expect(f.gmail.status).toHaveBeenCalledWith('room:room-1', LOCAL_GMAIL_RECIPIENT)
    expect(f.continuation).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'room-thread', sourceTurnId: 'turn-1', key: 'card-1' }))
    expect(await f.request()).toMatchObject({ resumed: true })
    expect(f.continuation).toHaveBeenCalledTimes(1)
  })

  it('cannot claim a connection by pressing complete or configuring a fake MCP Gmail server', async () => {
    const f = await fixture()
    f.status.connected = false
    await expect(f.request()).rejects.toThrow('Connect Gmail')
    f.status.connected = true
    f.status.allowModelSharing = false
    await expect(f.request()).rejects.toThrow('allow this conversation')
    f.status.allowModelSharing = true
    f.status.scopes = [GMAIL_SCOPES[0]]
    await expect(f.request()).rejects.toThrow('Connect Gmail')
    expect(f.continuation).not.toHaveBeenCalled()
    expect(f.rows.get('card-1')!.value.appConnection).toMatchObject({ status: 'requested' })
  })

  it('rejects revoked Agent identities and changed provider permissions before task continuation', async () => {
    const f = await fixture()
    f.room.members[0].enabled = false
    await expect(f.request()).rejects.toThrow('active Agent')
    f.room.members[0].enabled = true
    const thread = (await f.threads.get('room-thread'))!
    thread.roomContext!.blockedProviderIds.push('gmail')
    await f.threads.upsert(thread)
    await expect(f.request()).rejects.toThrow('active Agent')
    expect(f.gmail.status).not.toHaveBeenCalled()
    expect(f.continuation).not.toHaveBeenCalled()
  })

  it('lets the user skip without granting Gmail access and keeps other Google apps unavailable', async () => {
    const f = await fixture()
    expect(await f.request('skip')).toMatchObject({ message: { appConnection: { status: 'skipped' } }, resumed: true })
    expect(f.gmail.status).not.toHaveBeenCalled()
    expect(f.continuation).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('without that app') }))
    const other = await fixture()
    ;(other.rows.get('card-1')!.value.appConnection as { serverId: string }).serverId = 'google_drive'
    await expect(other.request()).rejects.toThrow('unavailable in private Rooms')
  })
})
