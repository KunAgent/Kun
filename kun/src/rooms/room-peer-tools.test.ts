import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { applyRoomToolPolicy } from '../loop/room-turn-policy.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { putRoomDocument, RoomService } from './room-service.js'
import { RoomPeerStore } from './room-peer-state.js'
import { peerId, peerMemberId } from './room-peer-inbox.js'
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
  await putRoomDocument(store, 'peer_member', peerMemberId('topic', 'developer'), room.id, member, null)
  // Membership currency also needs the root request row the runtime writes on send.
  await putRoomDocument(store, 'request', 'topic', room.id,
    { id: 'topic', roomId: room.id, rootRequestId: 'topic', status: 'running' }, null)
  bindRoomPeerStore(threads, store)
  const tools = roomPeerTools(threads)
  const host = new LocalToolHost({ registry: new CapabilityRegistry([
    { id: 'peer', kind: 'built-in', enabled: true, available: true, tools }
  ]) })
  const context = applyRoomToolPolicy(rawContext(thread.id), thread)
  const tool = (name: string) => tools.find((entry) => entry.name === name)!
  const memberStateId = peerMemberId('topic', 'developer')
  const updateTopic = async (changes: Partial<RoomPeerTopic>) => {
    const row = (await store.get<RoomPeerTopic>('peer_topic', 'topic'))!
    await putRoomDocument(store, 'peer_topic', row.id, room.id, { ...row.value, ...changes }, row)
  }
  return { store, room, threads, thread, topic, member, tools, tool, host, context, updateTopic, memberStateId }
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
    const before = await f.store.get('peer_member', f.memberStateId)
    const result = await f.tool('read_room_updates').execute({}, f.context)
    const output = result.output as { draftIsStale: boolean; messages: Array<{ body: string }> }
    expect(output.draftIsStale).toBe(true)
    // Older generations are excluded before paging, so they cannot consume
    // a slot in the current topic's bounded result window.
    expect(output.messages).toHaveLength(20)
    expect(output.messages.every((entry) => entry.body.length <= 1500)).toBe(true)
    expect(JSON.stringify(output)).not.toMatch(/OTHER TOPIC SECRET|OLD GENERATION/)
    expect(await f.store.get('peer_member', f.memberStateId)).toEqual(before)
  })

  it('stages a valid reply and invitations without publishing, acknowledging or creating an execution task', async () => {
    const f = await fixture()
    const before = await f.store.get('peer_member', f.memberStateId)
    const events = await f.store.events(f.room.id)
    const result = await f.host.execute({ callId: 'stage', toolName: 'send_room_message',
      arguments: { body: 'The API needs an explicit cancellation contract.', inviteMemberIds: ['reviewer'] } }, f.context)
    expect(result.item).toMatchObject({ isError: false, output: { accepted: true, staged: true,
      value: { body: 'The API needs an explicit cancellation contract.', inviteMemberIds: ['reviewer'] } } })
    expect(await f.store.list('message', { roomId: f.room.id })).toHaveLength(0)
    expect(await f.store.list('task', { roomId: f.room.id })).toHaveLength(0)
    expect(await f.store.get('peer_member', f.memberStateId)).toEqual(before)
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

  const inboxItem = (f: Awaited<ReturnType<typeof fixture>>, id: string,
    kind: RoomPeerInboxItem['sourceKind'] = 'message'): RoomPeerInboxItem => ({
      roomId: f.room.id, rootRequestId: 'topic', memberId: 'developer', generation: 1, sourceKind: kind,
      sourceId: id, sourceRevision: 0, causeId: 'cause-' + id, body: 'Update from ' + id,
      authorMemberId: 'reviewer', createdAt: new Date().toISOString() })
  const activation = async (f: Awaited<ReturnType<typeof fixture>>) =>
    (await f.store.get<RoomPeerMemberState>('peer_member', f.memberStateId))!.value.activation!

  it('holds a stale draft, returns the unseen updates and rebases the activation once', async () => {
    const f = await fixture()
    await putRoomDocument(f.store, 'peer_inbox', 'held-1', f.room.id, inboxItem(f, 'update-a'), null)
    await putRoomDocument(f.store, 'peer_inbox', 'held-2', f.room.id, inboxItem(f, 'update-b'), null)
    await f.updateTopic({ publicationRevision: 2 })
    const before = await f.store.get<RoomPeerTopic>('peer_topic', 'topic')
    const result = await f.tool('send_room_message').execute({ body: 'Draft on old context' }, f.context)
    expect(result.isError).toBeUndefined()
    const output = result.output as { accepted: boolean; held?: boolean; reason?: string;
      updates?: Array<{ id: string; kind: string; authorMemberId?: string; body: string; truncated: boolean }>; note?: string }
    expect(output).toMatchObject({ accepted: false, held: true, reason: 'topic_changed' })
    expect(output.note).toContain('send_room_message')
    expect(output.updates).toHaveLength(2)
    expect(output.updates![0]).toMatchObject({ id: 'update-a', kind: 'message', authorMemberId: 'reviewer', truncated: false })
    const member = (await f.store.get<RoomPeerMemberState>('peer_member', f.memberStateId))!.value
    expect(member.activation).toMatchObject({ basePublicationRevision: 2, holds: 1 })
    expect(member.activation!.seenItems.map((item) => item.id)).toEqual(['held-1', 'held-2'])
    expect(member.activation!.seenThroughSeq).toBe(member.seenInboxSeq)
    expect(member.handledInboxSeq).toBe(0)
    // The hold never spends response or member budget.
    expect(await f.store.get<RoomPeerTopic>('peer_topic', 'topic')).toEqual(before)
  })

  it('stages the revised call after a hold and publishes without going stale', async () => {
    const f = await fixture()
    await putRoomDocument(f.store, 'peer_inbox', 'held-1', f.room.id, inboxItem(f, 'task-a', 'task'), null)
    await putRoomDocument(f.store, 'peer_inbox', 'held-2', f.room.id, inboxItem(f, 'task-b', 'task'), null)
    await f.updateTopic({ publicationRevision: 2 })
    expect((await f.tool('send_room_message').execute({ body: 'Draft on old context' }, f.context)).output)
      .toMatchObject({ held: true })
    const staged = await f.tool('send_room_message').execute({ body: 'Revised covering both updates' }, f.context)
    expect(staged.output).toMatchObject({ accepted: true, staged: true })
    const published = await new RoomPeerStore(f.store).publish({ rootRequestId: 'topic', memberId: 'developer',
      clientRequestId: 'revised-publish', activationClientRequestId: 'activation', body: 'Revised covering both updates' })
    expect(published).toMatchObject({ status: 'published' })
    expect((await f.store.get<RoomPeerMemberState>('peer_member', f.memberStateId))!.value.handledInboxSeq).toBeGreaterThan(0)
  })

  it('stages without holding when more than six updates are pending', async () => {
    const f = await fixture()
    for (let i = 0; i < 7; i++) {
      await putRoomDocument(f.store, 'peer_inbox', 'burst-' + i, f.room.id, inboxItem(f, 'burst-' + i), null)
    }
    await f.updateTopic({ publicationRevision: 2 })
    const result = await f.tool('send_room_message').execute({ body: 'Draft on old context' }, f.context)
    expect(result.output).toMatchObject({ accepted: true, staged: true })
    expect(await activation(f)).toMatchObject({ basePublicationRevision: 1, seenThroughSeq: 0 })
    expect((await activation(f)).holds).toBeUndefined()
  })

  it('stages without holding once the hold limit is spent', async () => {
    const f = await fixture()
    const row = (await f.store.get<RoomPeerMemberState>('peer_member', f.memberStateId))!
    await putRoomDocument(f.store, 'peer_member', f.memberStateId, f.room.id,
      { ...row.value, activation: { ...row.value.activation!, holds: 2 } }, row)
    await putRoomDocument(f.store, 'peer_inbox', 'late-1', f.room.id, inboxItem(f, 'late-a'), null)
    await f.updateTopic({ publicationRevision: 2 })
    const result = await f.tool('send_room_message').execute({ body: 'Draft on old context' }, f.context)
    expect(result.output).toMatchObject({ accepted: true, staged: true })
    expect(await activation(f)).toMatchObject({ basePublicationRevision: 1, holds: 2 })
  })

  it('stages the draft when a racing publication wins the rebase commit', async () => {
    const f = await fixture()
    await putRoomDocument(f.store, 'peer_inbox', 'race-1', f.room.id, inboxItem(f, 'race-a'), null)
    await f.updateTopic({ publicationRevision: 2 })
    const receiptId = peerId('rebase', 'activation', 2, ['race-1'])
    const commit = f.store.commit.bind(f.store)
    let injected = false
    vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (!injected && input.requestId === receiptId) {
        injected = true
        await f.updateTopic({ publicationRevision: 3 })
      }
      return commit(input)
    })
    const result = await f.tool('send_room_message').execute({ body: 'Draft on old context' }, f.context)
    expect(result.output).toMatchObject({ accepted: true, staged: true })
    expect(await activation(f)).toMatchObject({ basePublicationRevision: 1 })
    expect((await activation(f)).holds).toBeUndefined()
  })

  it('stages without holding while the activation is still a participation check', async () => {
    const f = await fixture()
    const row = (await f.store.get<RoomPeerMemberState>('peer_member', f.memberStateId))!
    await putRoomDocument(f.store, 'peer_member', f.memberStateId, f.room.id,
      { ...row.value, state: 'triaging', activation: { ...row.value.activation!, phase: 'triage' } }, row)
    await putRoomDocument(f.store, 'peer_inbox', 'triage-1', f.room.id, inboxItem(f, 'triage-a'), null)
    await f.updateTopic({ publicationRevision: 2 })
    const result = await f.tool('send_room_message').execute({ body: 'Draft on old context' }, f.context)
    expect(result.output).toMatchObject({ accepted: true, staged: true })
    expect(await activation(f)).toMatchObject({ phase: 'triage' })
    expect((await activation(f)).holds).toBeUndefined()
  })

  it('keeps the handoff branch ahead of the stale-draft hold', async () => {
    const f = await fixture()
    await putRoomDocument(f.store, 'peer_inbox', 'handoff-1', f.room.id, inboxItem(f, 'handoff-a'), null)
    await f.updateTopic({ publicationRevision: 2 })
    f.thread.roomContext!.handoffId = 'job-1'
    await f.threads.upsert(f.thread)
    const result = await f.tool('send_room_message').execute({ body: 'Handoff reply' }, f.context)
    expect(result.isError).toBe(true)
    expect((result.output as { held?: unknown }).held).toBeUndefined()
    expect(await activation(f)).toMatchObject({ basePublicationRevision: 1 })
    expect((await activation(f)).holds).toBeUndefined()
  })
})
