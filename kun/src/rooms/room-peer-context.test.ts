import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RoomMessage } from '../contracts/rooms.js'
import { RoomService } from './room-service.js'
import { SqliteRoomStore } from './room-store-sqlite.js'
import { RoomPeerStore } from './room-peer-state.js'
import { prepareRoomPeerContext } from './room-peer-context.js'
import { ROOM_PEER_GUIDANCE } from './room-collaboration-guidance.js'
import type { RoomRequestState, RoomRuntimeDeps } from './room-runtime-types.js'
import type { RoomContextSnapshot } from '../contracts/rooms-product.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture(context?: Partial<RoomContextSnapshot>) {
  const directory = await mkdtemp(join(tmpdir(), 'kun-peer-context-'))
  const store = new SqliteRoomStore({ path: join(directory, 'rooms.sqlite') })
  cleanup.push(async () => { await store.close(); await rm(directory, { recursive: true, force: true }) })
  const service = new RoomService(store, () => {})
  const room = (await service.create({ clientRequestId: 'create', name: 'Peer context' })).room
  const sent = await service.send(room.id, { clientRequestId: 'root', body: 'Discuss the design.', executionIntent: 'discussion' })
  const request = (await store.get<RoomRequestState>('request', sent.requestId))!
  const peer = new RoomPeerStore(store)
  await peer.initialize(request.value)
  const contextId = 'context-' + sent.requestId
  await store.commit({ requestId: contextId, checks: [{ kind: 'context', id: contextId, expectedRevision: null }],
    puts: [{ kind: 'context', id: contextId, roomId: room.id, value: { id: contextId, roomId: room.id,
      coveredSeq: 0, summary: '', messages: [], rules: [], truncated: false, ...context } }] })
  const deps = { store, model: () => ({ model: 'fake' }), profiles: () => ({}) } as unknown as RoomRuntimeDeps
  const member = room.members.find((value) => value.id === 'developer')!
  const put = async (id: string, body: string) => store.commit({ requestId: id,
    checks: [{ kind: 'message', id, expectedRevision: null }],
    puts: [{ kind: 'message', id, roomId: room.id, value: {
      ...(sent.message as RoomMessage), id, body, status: 'final' } }] })
  return { store, service, room, sent, peer, deps, member, put }
}
function parsedReference(prompt: string) {
  const json = prompt.split('\n').find((line) => line.startsWith('{"member":'))
  expect(json).toBeDefined()
  return JSON.parse(json!) as { reference: { context: { messages: unknown[]; summary: string; truncated: boolean };
    topicHistory: Array<{ body: string; truncated: boolean }>;
    updates: Array<{ inboxId: string; body: string; truncated: boolean }> } }
}

describe('peer response context', () => {
  it('appends the shared collaboration guidance after the standing rules and before the frozen input', async () => {
    const f = await fixture()
    const updates = (await f.peer.readUpdates(f.sent.requestId, 'developer'))!
    const context = await prepareRoomPeerContext(f.deps, updates, f.member)
    const lines = context.prompt.split('\n')
    for (const line of ROOM_PEER_GUIDANCE) expect(lines).toContain(line)
    expect(context.prompt).not.toContain('exchange acknowledgements')
    const guidanceIndex = lines.indexOf(ROOM_PEER_GUIDANCE[0])
    const jsonIndex = lines.findIndex((line) => line.startsWith('{"member":'))
    expect(guidanceIndex).toBeGreaterThan(-1)
    expect(guidanceIndex).toBeLessThan(jsonIndex)
  })

  it('drains room history before touching topic history or the pending updates', async () => {
    const f = await fixture({
      summary: 's'.repeat(3000),
      messages: Array.from({ length: 24 }, (_, index) => ({ id: 'old-' + index, author: 'peer', body: 'm'.repeat(1000) }))
    })
    for (let index = 0; index < 6; index += 1) await f.put('recent-' + index, 'r'.repeat(1400))
    const updates = (await f.peer.readUpdates(f.sent.requestId, 'developer'))!
    const source = (id: string) => ({ ...updates.items[0], id: 'inbox-' + id,
      value: { ...updates.items[0].value, sourceId: id, body: 'u'.repeat(1500) } })
    const context = await prepareRoomPeerContext(f.deps,
      { ...updates, items: [source('a'), source('b'), source('c')] }, f.member)
    const reference = parsedReference(context.prompt).reference
    expect(reference.context.messages.length).toBeLessThan(24)
    expect(reference.context.truncated).toBe(true)
    expect(reference.topicHistory).toHaveLength(6)
    expect(reference.updates).toHaveLength(3)
    expect(reference.updates.every((item) => item.body.length === 1500 && !item.truncated)).toBe(true)
  })

  it('drops recent topic history before sacrificing any pending update', async () => {
    const f = await fixture()
    for (let index = 0; index < 6; index += 1) await f.put('recent-' + index, 'r'.repeat(1400))
    const updates = (await f.peer.readUpdates(f.sent.requestId, 'developer'))!
    const source = (id: string) => ({ ...updates.items[0], id: 'inbox-' + id,
      value: { ...updates.items[0].value, sourceId: id, body: 'u'.repeat(1500) } })
    const context = await prepareRoomPeerContext(f.deps,
      { ...updates, items: ['a', 'b', 'c', 'd', 'e', 'f'].map(source) }, f.member)
    const reference = parsedReference(context.prompt).reference
    expect(reference.topicHistory.length).toBeLessThan(6)
    expect(reference.updates).toHaveLength(6)
    expect(reference.updates.every((item) => item.body.length === 1500 && !item.truncated)).toBe(true)
  })

  it('pops newer pending updates from the end before shrinking the first update body', async () => {
    const f = await fixture()
    const updates = (await f.peer.readUpdates(f.sent.requestId, 'developer'))!
    const source = (index: number) => ({ ...updates.items[0], id: 'inbox-' + index,
      value: { ...updates.items[0].value, sourceId: 'source-' + index, body: 'u'.repeat(1500) } })
    const context = await prepareRoomPeerContext(f.deps,
      { ...updates, items: Array.from({ length: 12 }, (_, index) => source(index)) }, f.member)
    const reference = parsedReference(context.prompt).reference
    expect(reference.updates.length).toBeGreaterThan(1)
    expect(reference.updates.length).toBeLessThan(12)
    expect(reference.updates[0].inboxId).toBe('inbox-0')
    expect(reference.updates.every((item) => item.body.length === 1500 && !item.truncated)).toBe(true)
  })
})
