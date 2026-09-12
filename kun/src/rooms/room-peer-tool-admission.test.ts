import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomService } from './room-service.js'
import { RoomPeerStore } from './room-peer-state.js'
import { bindRoomPeerStore, roomPeerTools } from './room-peer-tools.js'
import type { RoomRequestState } from './room-runtime-types.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(turnClientRequestId: string | undefined = 'activation') {
  const root = await mkdtemp(join(tmpdir(), 'kun-peer-tool-admission-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  cleanups.push(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  const service = new RoomService(store, () => {}), peer = new RoomPeerStore(store)
  const room = (await service.create({ clientRequestId: 'room', name: 'Receipt race' })).room
  const sent = await service.send(room.id, { clientRequestId: 'input', body: 'Discuss the exact receipt identity.', executionIntent: 'discussion' })
  await peer.initialize((await store.get<RoomRequestState>('request', sent.requestId))!.value)
  const updates = (await peer.readUpdates(sent.requestId, 'developer'))!
  await peer.begin(sent.requestId, 'developer', { threadId: 'member-thread', clientRequestId: 'activation', contextId: 'context',
    attempt: 1, phase: 'respond', generation: updates.topic.value.generation,
    basePublicationRevision: updates.topic.value.publicationRevision, itemIds: updates.items.map((item) => item.id) })
  await peer.updateActivation(sent.requestId, 'developer', 'activation', { admissionAttempted: true })
  const threads = new InMemoryThreadStore()
  const thread = createThreadRecord({ id: 'member-thread', title: 'Developer', workspace: root, model: 'test',
    roomContext: { roomId: room.id, rootRequestId: sent.requestId, collaborationProtocol: 'peer', memberId: 'developer',
      kind: 'discussion', blockedToolNames: [], blockedSkillIds: [], blockedProviderIds: [] } })
  thread.turns.push(createTurnRecord({ id: 'turn', threadId: thread.id, clientRequestId: turnClientRequestId, prompt: 'Frozen peer context', status: 'running' }))
  await threads.upsert(thread)
  bindRoomPeerStore(threads, store)
  const context: ToolHostContext = { threadId: thread.id, turnId: 'turn', workspace: root,
    sandboxMode: 'read-only', approvalPolicy: 'auto', threadMode: 'plan', roomStepKind: 'discussion', roomPeer: true,
    abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' }
  const tool = (name: string) => roomPeerTools(threads).find((entry) => entry.name === name)!
  return { store, peer, room, sent, threads, thread, context, tool }
}

describe('peer tools during the durable admission receipt race', () => {
  it('accepts the exact persisted request identity before activation.turnId is saved without publishing directly', async () => {
    const f = await fixture()
    const before = await f.peer.member(f.sent.requestId, 'developer')
    expect(before!.value.activation!.turnId).toBeUndefined()
    expect(await f.tool('send_room_message').execute({ body: 'Exact staged response.' }, f.context)).toMatchObject({
      output: { accepted: true, staged: true, value: { body: 'Exact staged response.' } }
    })
    expect(await f.tool('read_room_updates').execute({}, f.context)).toMatchObject({ output: { generation: 1 } })
    expect(await f.peer.member(f.sent.requestId, 'developer')).toEqual(before)
    expect(await f.store.list('message', { rootRequestId: f.sent.requestId })).toHaveLength(1)
  })

  it.each(['different-request', undefined])('rejects an early turn with a different or missing request identity (%s)', async (id) => {
    const f = await fixture(id ?? 'activation')
    f.thread.turns[0].clientRequestId = id
    await f.threads.upsert(f.thread)
    expect(await f.tool('send_room_message').execute({ body: 'Unrelated turn output' }, f.context)).toMatchObject({ isError: true })
    expect(await f.tool('read_room_updates').execute({}, f.context)).toMatchObject({ isError: true })
  })

  it('keeps an already recorded turn ID authoritative instead of using a matching request ID to bypass it', async () => {
    const f = await fixture()
    await f.peer.updateActivation(f.sent.requestId, 'developer', 'activation', { turnId: 'different-durable-turn' })
    expect(await f.tool('send_room_message').execute({ body: 'Wrong recorded turn' }, f.context)).toMatchObject({ isError: true })
  })
})
