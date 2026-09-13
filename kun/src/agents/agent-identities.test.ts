import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomService } from '../rooms/room-service.js'
import { AgentIdentityService } from './agent-identity-service.js'
import { openAgentConversation, openAgentPairConversation } from './agent-conversations.js'
import type { Room } from '../contracts/rooms.js'

const resources: Array<{ store: SqliteRoomStore; dir: string }> = []
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-agent-identities-'))
  const store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  resources.push({ store, dir })
  const agents = new AgentIdentityService(store, () => ({
    general: { mode: 'subagent', toolPolicy: 'inherit', systemPrompt: 'original profile', blockedTools: [] }
  }))
  const rooms = new RoomService(store, () => {})
  return { store, agents, rooms }
}
afterEach(async () => {
  for (const { store, dir } of resources.splice(0)) { await store.close(); await rm(dir, { recursive: true, force: true }) }
})

describe('persistent agent identity and conversations', () => {
  it('migrates same-named legacy members separately without replaying messages or pending requests', async () => {
    const { store, agents, rooms } = await fixture()
    const a = await rooms.create({ clientRequestId: 'a', name: 'One' })
    const b = await rooms.create({ clientRequestId: 'b', name: 'Two' })
    const sent = await rooms.send(a.room.id, { clientRequestId: 'pending', body: 'Keep the original request' })
    const request = await store.get('request', sent.requestId)
    const beforeEvents = await store.events('*')
    await agents.initialize()
    const identities = (await agents.list({ limit: 100 })).agents
    expect(identities).toHaveLength(6)
    expect(new Set(identities.map((agent) => agent.id)).size).toBe(6)
    const afterA = (await store.get<Room>('room', a.room.id))!.value
    const afterB = (await store.get<Room>('room', b.room.id))!.value
    expect(afterA.members[0].participantAgentId).not.toBe(afterB.members[0].participantAgentId)
    expect(await store.get('request', sent.requestId)).toEqual(request)
    expect((await store.events('*', beforeEvents.at(-1)!.seq)).every((event) => event.kind === 'room.updated')).toBe(true)
    await new AgentIdentityService(store, () => ({})).initialize()
    expect((await agents.list({ limit: 100 })).agents).toHaveLength(6)
  })

  it('opens one persistent private conversation, separate from group lists, and freezes request configuration', async () => {
    const { store, agents, rooms } = await fixture()
    rooms.setAgentDirectory(agents)
    const { agent } = await agents.create({ clientRequestId: 'a', name: 'Ada', instructions: 'Use evidence',
      modelRef: { providerId: 'native', model: 'model-one' } })
    const [a, b] = await Promise.all([openAgentConversation(agents, rooms, agent.id), openAgentConversation(agents, rooms, agent.id)])
    expect(a.room.id).toBe(b.room.id)
    expect((await store.listRooms()).rooms).toHaveLength(0)
    expect((await store.listRooms({ conversationKind: 'user_agent' })).rooms).toHaveLength(1)
    const sent = await rooms.send(a.room.id, { clientRequestId: 'question', body: 'Explain', executionIntent: 'discussion' })
    await agents.update(agent.id, { clientRequestId: 'change', expectedRevision: 0, instructions: 'A new role',
      modelRef: { providerId: 'native', model: 'model-two' } })
    const original = await store.get<{ roomSnapshot: Room }>('request', sent.requestId)
    expect(original!.value.roomSnapshot.members[0].modelRef?.model).toBe('model-one')
    expect(original!.value.roomSnapshot.members[0].agentInstructions).toBe('Use evidence')
    const next = await rooms.send(a.room.id, { clientRequestId: 'next', body: 'Next', executionIntent: 'discussion' })
    expect((await store.get<{ roomSnapshot: Room }>('request', next.requestId))!.value.roomSnapshot.members[0].modelRef?.model).toBe('model-two')
    await expect(rooms.update(a.room.id, { clientRequestId: 'replace', expectedRevision: a.room.revision,
      members: [{ ...a.room.members[0], id: 'replacement' }], defaultMemberId: 'replacement' })).rejects.toThrow('participants cannot change')
  })

  it('keeps one order-independent peer transcript and rejects unscoped user sends into it', async () => {
    const { agents, rooms } = await fixture()
    rooms.setAgentDirectory(agents)
    const a = (await agents.create({ clientRequestId: 'a', name: 'Ada' })).agent
    const b = (await agents.create({ clientRequestId: 'b', name: 'Bea' })).agent
    const pair = await openAgentPairConversation(agents, rooms, a.id, b.id)
    expect((await openAgentPairConversation(agents, rooms, b.id, a.id)).room.id).toBe(pair.room.id)
    await expect(rooms.send(pair.room.id, { clientRequestId: 'sneak', body: 'A new authority' })).rejects.toThrow('source conversation')
  })

  it('copies configuration without sharing identity/history and preserves archived history', async () => {
    const { agents, rooms, store } = await fixture()
    rooms.setAgentDirectory(agents)
    const a = (await agents.create({ clientRequestId: 'a', name: 'Ada', instructions: 'Be precise' })).agent
    const direct = await openAgentConversation(agents, rooms, a.id)
    const copy = (await agents.create({ clientRequestId: 'copy', copyFromAgentId: a.id, name: 'Ada copy' })).agent
    expect(copy.id).not.toBe(a.id)
    expect(copy.instructions).toBe(a.instructions)
    expect((await store.list('room')).length).toBe(1)
    await agents.update(a.id, { clientRequestId: 'archive', expectedRevision: 0, archived: true })
    expect((await openAgentConversation(agents, rooms, a.id)).room.id).toBe(direct.room.id)
    await expect(rooms.send(direct.room.id, { clientRequestId: 'new', body: 'Work' })).rejects.toThrow('unavailable')
    await agents.update(a.id, { clientRequestId: 'restore', expectedRevision: 1, archived: false })
    expect((await agents.active(a.id)).instructions).toBe('Be precise')
  })
})
