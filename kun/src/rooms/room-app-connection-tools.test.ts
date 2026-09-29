import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { RoomMessage } from '../contracts/rooms.js'
import { RoomRunRecordSchema } from '../contracts/room-runs.js'
import { RoomService, putRoomDocument } from './room-service.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { bindRoomPeerStore } from './room-peer-tools.js'
import { roomRunId } from './room-run-recording.js'
import { bindRoomAppAccess, roomAppConnectionTools } from './room-app-connection-tools.js'
import { markRoomAppConnectionResumed, setRoomAppConnectionStatus } from './room-app-connections.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'room-app-tool-'))
  const store = new SqliteRoomStore({ path: join(directory, 'rooms.sqlite') })
  const service = new RoomService(store, () => {})
  const threads = new InMemoryThreadStore()
  bindRoomPeerStore(threads, store)
  bindRoomAppAccess(threads, () => ({ servers: {}, statuses: {} }))
  const member = { id: 'agent-member', displayName: 'Bot', participantAgentId: 'agent-1',
    presetId: 'general', role: 'developer' as const, roleNotes: '', enabled: true,
    revision: 0, allowedRepositoryIds: [] }
  const room = (await service.create({ clientRequestId: 'create-room', name: 'Bot', members: [member] },
    { id: 'private-room', conversationKind: 'user_agent' })).room
  const thread = createThreadRecord({ id: 'conv-thread', title: 'Bot', workspace: directory, model: 'test',
    roomContext: { roomId: room.id, memberId: member.id, participantAgentId: 'agent-1', kind: 'conversation',
      blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] } })
  const turn = createTurnRecord({ id: 'turn-1', threadId: thread.id, prompt: 'Gmail', clientRequestId: 'req-1', status: 'running' })
  thread.turns.push(turn)
  await threads.upsert(thread)
  const runId = roomRunId(room.id, 'req-1'), now = new Date().toISOString()
  await putRoomDocument(store, 'room_run', runId, room.id, RoomRunRecordSchema.parse({
    id: runId, roomId: room.id, memberId: member.id, memberLabel: 'Bot', participantAgentId: 'agent-1',
    phase: 'conversation', attempt: 1, clientRequestId: 'req-1', threadId: thread.id, turnId: turn.id,
    input: 'Gmail', attachmentIds: [], status: 'running', createdAt: now, updatedAt: now
  }), null)
  const context: ToolHostContext = { threadId: thread.id, turnId: turn.id, workspace: directory,
    sandboxMode: 'workspace-write', approvalPolicy: 'auto', threadMode: 'agent', roomStepKind: 'conversation',
    roomAgent: true, activeToolCallId: 'call-1', abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow' }
  cleanup.push(async () => { await store.close(); await rm(directory, { recursive: true, force: true }) })
  const tools = roomAppConnectionTools(threads)
  return { store, threads, room, context,
    list: tools.find((tool) => tool.name === 'list_room_apps')!,
    request: tools.find((tool) => tool.name === 'request_app_connection')! }
}

describe('Room app connection cards', () => {
  it('lists safe app identities and publishes one durable Gmail card', async () => {
    const f = await fixture()
    expect((await f.list.execute({}, f.context)).output).toMatchObject({ suggested: expect.arrayContaining([{ id: 'google_gmail', name: 'Gmail' }]) })
    const first = await f.request.execute({ serverId: 'gmail', reason: 'I need Gmail to search your inbox.' }, f.context)
    expect(first.isError).not.toBe(true)
    const id = (first.output as { messageId: string }).messageId
    const card = (await f.store.get<RoomMessage>('message', id))!.value
    expect(card).toMatchObject({ presentationKind: 'app_connection', body: 'I need Gmail to search your inbox.',
      appConnection: { serverId: 'google_gmail', status: 'requested', resumed: false }, originRunId: expect.any(String) })
    const repeat = await f.request.execute({ serverId: 'gmail', reason: 'I need Gmail to search your inbox.' }, f.context)
    expect((repeat.output as { messageId: string }).messageId).toBe(id)
    const secondCall = await f.request.execute({ serverId: 'gmail', reason: 'Same app' }, { ...f.context, activeToolCallId: 'call-2' })
    expect((secondCall.output as { messageId: string }).messageId).toBe(id)
    expect(await f.store.list('message', { roomId: f.room.id })).toHaveLength(1)
    await setRoomAppConnectionStatus(f.store, f.room.id, id, 'connected')
    await markRoomAppConnectionResumed(f.store, f.room.id, id)
    expect((await f.store.get<RoomMessage>('message', id))!.value.appConnection).toMatchObject({ status: 'connected', resumed: true })
    await expect(setRoomAppConnectionStatus(f.store, f.room.id, id, 'skipped')).rejects.toThrow('already resolved')
  })

  it('rejects unknown apps, blocked apps and fabricated turn scope', async () => {
    const f = await fixture()
    expect((await f.request.execute({ serverId: 'unknown', reason: 'Need it' }, f.context)).isError).toBe(true)
    expect((await f.request.execute({ serverId: 'gmail', reason: 'Need it' }, { ...f.context, turnId: 'wrong' })).isError).toBe(true)
    const thread = (await f.threads.get('conv-thread'))!
    thread.roomContext!.blockedProviderIds.push('mcp:google_gmail')
    await f.threads.upsert(thread)
    expect((await f.request.execute({ serverId: 'gmail', reason: 'Need it' }, f.context)).isError).toBe(true)
    expect(await f.store.list('message', { roomId: f.room.id })).toHaveLength(0)
  })
})
