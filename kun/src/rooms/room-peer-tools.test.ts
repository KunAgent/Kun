import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { applyRoomToolPolicy } from '../loop/room-turn-policy.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { putRoomDocument, RoomService } from './room-service.js'
import { bindRoomPeerStore, roomPeerTools } from './room-peer-tools.js'
import type { RoomPeerInboxItem, RoomPeerMemberState, RoomPeerTopic } from './room-peer-types.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
function rawContext(threadId: string): ToolHostContext {
  return { threadId, turnId: 'turn', workspace: '/workspace', sandboxMode: 'read-only', approvalPolicy: 'auto',
    threadMode: 'plan', abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' }
}
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'room-peer-tools-'))
  cleanups.push(() => rm(path, { recursive: true, force: true }))
  const store = new SqliteRoomStore({ path: join(path, 'rooms.sqlite') })
  cleanups.push(() => store.close())
  const service = new RoomService(store, () => {})
  const { room } = await service.create({ clientRequestId: 'room', name: 'Room', collaborationMode: 'peer' })
  const threads = new InMemoryThreadStore()
  const thread = createThreadRecord({ id: 'member-thread', title: 'Developer', workspace: '/workspace', model: 'test',
    roomContext: { roomId: room.id, rootRequestId: 'topic', collaborationProtocol: 'peer', memberId: 'developer',
      kind: 'discussion', blockedToolNames: [], blockedSkillIds: [], blockedProviderIds: [] } })
  thread.turns.push(createTurnRecord({ id: 'turn', threadId: thread.id, prompt: 'Discuss', status: 'running' }))
  await threads.upsert(thread)
  const now = new Date().toISOString()
  const topic: RoomPeerTopic = { roomId: room.id, rootRequestId: 'topic', requestId: 'topic', sourceMessageId: 'source',
    generation: 1, title: 'Current topic', publicationRevision: 1, status: 'active', responseCount: 0, triageCount: 0,
    memberResponses: {}, memberIds: room.members.map((member) => member.id), roomSnapshot: room, createdAt: now, updatedAt: now }
  const member: RoomPeerMemberState = { roomId: room.id, rootRequestId: 'topic', memberId: 'developer', generation: 1,
    state: 'responding', seenInboxSeq: 0, handledInboxSeq: 0, updatedAt: now,
    activation: { threadId: thread.id, turnId: 'turn', clientRequestId: 'activation', contextId: 'context', seenItems: [],
      seenThroughSeq: 0, basePublicationRevision: 1, generation: 1, attempt: 1, phase: 'respond' } }
  await putRoomDocument(store, 'peer_topic', 'topic', room.id, topic, null)
  await putRoomDocument(store, 'peer_member', 'member-state', room.id, member, null)
  bindRoomPeerStore(threads, store)
  const tools = roomPeerTools(threads)
  const host = new LocalToolHost({ registry: new CapabilityRegistry([
    { id: 'peer', kind: 'built-in', enabled: true, available: true, tools }
  ]) })
  const context = applyRoomToolPolicy(rawContext(thread.id), thread)
  const tool = (name: string) => tools.find((entry) => entry.name === name)!
  const updateTopic = async (changes: Partial<RoomPeerTopic>) => {
    const row = (await store.get<RoomPeerTopic>('peer_topic', 'topic'))!
    await putRoomDocument(store, 'peer_topic', row.id, room.id, { ...row.value, ...changes }, row)
  }
  return { store, room, threads, thread, topic, member, tools, tool, host, context, updateTopic }
}

describe('peer discussion tools', () => {
  it('advertises only for peer discussion and retains a read-only capability surface', async () => {
    const f = await fixture()
    expect(await f.host.listTools(rawContext('normal'))).toEqual([])
    expect(await f.host.listTools({ ...f.context, roomPeer: false })).toEqual([])
    expect(await f.host.listTools({ ...f.context, roomStepKind: 'execution' })).toEqual([])
    expect((await f.host.listTools(f.context)).map((tool) => tool.name)).toEqual(['read_room_updates', 'send_room_message'])
    for (const tool of f.tools) expect(tool.effects).toEqual({ network: false, externalWrite: false, processExecution: false, guiAutomation: false })
    expect(f.context.sandboxMode).toBe('read-only')
    await expect(f.host.execute({ callId: 'write', toolName: 'write', arguments: { path: 'file', content: 'changed' } }, f.context)).rejects.toThrow()
  })

  it('requires persisted thread/turn/topic identity even when a caller fabricates peer context', async () => {
    const f = await fixture()
    const send = f.tool('send_room_message')
    expect(await send.execute({ body: 'Forged' }, { ...f.context, threadId: 'unknown' })).toMatchObject({ isError: true })
    expect(await send.execute({ body: 'Wrong turn' }, { ...f.context, turnId: 'unknown' })).toMatchObject({ isError: true })
    expect(await send.execute({ body: 'Cross-topic', rootRequestId: 'other-topic' }, f.context)).toMatchObject({ isError: true })
    f.thread.roomContext!.rootRequestId = 'other-topic'
    await f.threads.upsert(f.thread)
    expect(await send.execute({ body: 'Cross-topic' }, f.context)).toMatchObject({ isError: true })
    expect(await f.store.list('message', { roomId: f.room.id })).toHaveLength(0)
  })

  it.each([{ generation: 2 }, { status: 'stopped' }, { status: 'paused' }] as Partial<RoomPeerTopic>[])('rejects invalidated activation state %j', async (change) => {
      const f = await fixture()
      await f.updateTopic(change)
      expect(await f.tool('send_room_message').execute({ body: 'Too late' }, f.context)).toMatchObject({ isError: true })
      expect(await f.tool('read_room_updates').execute({}, f.context)).toMatchObject({ isError: true })
  })

  it('returns bounded current-topic references without consuming inbox or exposing another topic', async () => {
    const f = await fixture()
    const item = (index: number, rootRequestId = 'topic', generation = 1): RoomPeerInboxItem => ({
      roomId: f.room.id, rootRequestId, memberId: 'developer', generation, sourceKind: 'message',
      sourceId: 'message-' + index, sourceRevision: 0, causeId: 'cause', body: index + ': ' + 'Reference '.repeat(400), createdAt: new Date().toISOString() })
    await putRoomDocument(f.store, 'peer_inbox', 'foreign-topic', f.room.id, { ...item(90, 'other-topic'), body: 'OTHER TOPIC SECRET' }, null)
    await putRoomDocument(f.store, 'peer_inbox', 'old-generation', f.room.id, { ...item(91, 'topic', 0), body: 'OLD GENERATION' }, null)
    for (let i = 0; i < 25; i++) await putRoomDocument(f.store, 'peer_inbox', 'item-' + i, f.room.id, item(i), null)
    await f.updateTopic({ publicationRevision: 2 })
    const before = await f.store.get('peer_member', 'member-state')
    const result = await f.tool('read_room_updates').execute({}, f.context)
    const output = result.output as { draftIsStale: boolean; messages: Array<{ body: string }> }
    expect(output.draftIsStale).toBe(true)
    // Older generations are excluded before paging, so they cannot consume
    // a slot in the current topic's bounded result window.
    expect(output.messages).toHaveLength(20)
    expect(output.messages.every((entry) => entry.body.length <= 1500)).toBe(true)
    expect(JSON.stringify(output)).not.toMatch(/OTHER TOPIC SECRET|OLD GENERATION/)
    expect(await f.store.get('peer_member', 'member-state')).toEqual(before)
  })

  it('stages a valid reply and invitations without publishing, acknowledging or creating an execution task', async () => {
    const f = await fixture()
    const before = await f.store.get('peer_member', 'member-state')
    const events = await f.store.events(f.room.id)
    const result = await f.host.execute({ callId: 'stage', toolName: 'send_room_message',
      arguments: { body: 'The API needs an explicit cancellation contract.', inviteMemberIds: ['reviewer'] } }, f.context)
    expect(result.item).toMatchObject({ isError: false, output: { accepted: true, staged: true,
      value: { body: 'The API needs an explicit cancellation contract.', inviteMemberIds: ['reviewer'] } } })
    expect(await f.store.list('message', { roomId: f.room.id })).toHaveLength(0)
    expect(await f.store.list('task', { roomId: f.room.id })).toHaveLength(0)
    expect(await f.store.get('peer_member', 'member-state')).toEqual(before)
    expect(await f.store.events(f.room.id)).toEqual(events)
    expect(await f.tool('send_room_message').execute({ skip: true }, f.context)).toMatchObject({ output: { accepted: true, staged: true, value: { skip: true } } })
  })

  it.each([
    { body: ' ' }, { body: 'x'.repeat(16001) }, { skip: true, body: 'Still speaking' },
    { skip: true, inviteMemberIds: ['reviewer'] }, { body: 'Self invite', inviteMemberIds: ['developer'] },
    { body: 'Unknown', mentionMemberIds: ['missing'] }, { body: 'Execute', taskId: 'forged-task' },
    { body: 'Execute', executionIntent: 'execute' }, { body: 'Use tool', command: 'touch unauthorized' }
  ])('rejects malformed content, scope or authority %j', async (input) => {
    const f = await fixture()
    expect(await f.tool('send_room_message').execute(input, f.context)).toMatchObject({ isError: true })
    expect(await f.store.list('task', { roomId: f.room.id })).toHaveLength(0)
  })

  it('rejects invitations to disabled or departed members', async () => {
    const f = await fixture()
    await f.updateTopic({ roomSnapshot: { ...f.room, members: f.room.members.map((member) => member.id === 'reviewer'
      ? { ...member, enabled: false } : member) } })
    expect(await f.tool('send_room_message').execute({ body: 'Review this', inviteMemberIds: ['reviewer'] }, f.context)).toMatchObject({ isError: true })
  })
})
