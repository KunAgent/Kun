import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentIdentityService } from './agent-identity-service.js'
import { AgentMemoryService } from './agent-memory-service.js'
import { openAgentConversation } from './agent-conversations.js'
import { RoomService } from '../rooms/room-service.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { FileMemoryStore } from '../memory/memory-store.js'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'

const resources: Array<{ store: SqliteRoomStore; root: string }> = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-agent-memory-service-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  resources.push({ store, root })
  const agents = new AgentIdentityService(store, () => ({}))
  const rooms = new RoomService(store, () => {}); rooms.setAgentDirectory(agents)
  const storage = new FileMemoryStore({ rootDir: join(root, 'memory'), config: MemoryCapabilityConfig.parse({ enabled: true }) })
  const service = new AgentMemoryService(agents, () => storage)
  const agent = (await agents.create({ clientRequestId: 'a', name: 'Ada' })).agent
  const room = (await openAgentConversation(agents, rooms, agent.id)).room
  const message = (await rooms.send(room.id, { clientRequestId: 'm', body: 'Remember that reports use Chinese.' })).message
  const input = { clientRequestId: 'remember', conversationId: room.id, sourceMessageIds: [message.id],
    content: 'Reports use Chinese.', type: 'preference' }
  return { root, store, agents, rooms, storage, service, agent, room, message, input }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const { store, root } of resources.splice(0)) { await store.close(); await rm(root, { recursive: true, force: true }) }
})
describe('agent memory service', () => {
  it('binds real conversation evidence and keeps explicit preferences local until shared', async () => {
    const f = await fixture()
    const saved = await f.service.create(f.agent.id, f.input)
    expect(saved.memory.agentContext?.locked).toBe(true)
    expect((await f.service.context(f.agent.id, f.room.id, 'Reports Chinese')).records).toHaveLength(1)
    expect((await f.service.context(f.agent.id, 'other-room', 'Reports Chinese')).records).toHaveLength(0)
    await expect(f.service.create(f.agent.id, { ...f.input, clientRequestId: 'fake', sourceMessageIds: ['missing'] })).rejects.toThrow('source message')
    await f.service.edit(f.agent.id, saved.memory.id, { clientRequestId: 'share', expectedFingerprint: saved.fingerprint, shared: true })
    expect((await f.service.context(f.agent.id, 'other-room', 'Reports Chinese')).text).toContain('authority="reference"')
    const changed = (await f.service.list(f.agent.id, {})).memories[0]
    await f.service.edit(f.agent.id, saved.memory.id, { clientRequestId: 'forget', expectedFingerprint: changed.fingerprint, forget: true })
    expect((await f.service.context(f.agent.id, f.room.id, 'Reports Chinese')).records).toHaveLength(0)
    const replay = await f.service.create(f.agent.id, f.input)
    expect(replay.memory.deletedAt).toBeTruthy()
    expect((await f.service.list(f.agent.id, {})).memories).toHaveLength(0)
  })

  it('recovers a committed canonical edit after losing its room receipt without applying twice', async () => {
    const f = await fixture()
    const saved = await f.service.create(f.agent.id, f.input)
    const originalCommit = f.store.commit.bind(f.store)
    let lost = false
    vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (!lost && input.requestId.startsWith('agent-memory-edit-')) { lost = true; throw new Error('lost receipt') }
      return originalCommit(input)
    })
    const edit = { clientRequestId: 'correct', expectedFingerprint: saved.fingerprint, content: 'Reports use Chinese with source links.' }
    await expect(f.service.edit(f.agent.id, saved.memory.id, edit)).rejects.toThrow('lost receipt')
    const applied = await f.storage.getById(saved.memory.id, { agent: { agentId: f.agent.id, manage: true } })
    const replay = await f.service.edit(f.agent.id, saved.memory.id, edit) as { memory: typeof applied }
    expect(replay.memory).toEqual(applied)
    expect((await f.store.list('agent_memory_job', { status: 'prepared' }))).toHaveLength(0)
    await expect(f.service.edit(f.agent.id, saved.memory.id, { ...edit, clientRequestId: 'stale' })).rejects.toThrow('memory changed')
  })

  it('rejects sensitive memory and mismatched source or operation identities', async () => {
    const f = await fixture()
    await expect(f.service.create(f.agent.id, { ...f.input, content: 'api_key=abcdefghijk1234567' })).rejects.toThrow('credential')
    const other = (await f.agents.create({ clientRequestId: 'b', name: 'Bea' })).agent
    await expect(f.service.create(other.id, f.input)).rejects.toThrow('source conversation')
    await f.service.create(f.agent.id, f.input)
    await expect(f.service.create(f.agent.id, { ...f.input, content: 'Changed input with reused key' })).rejects.toThrow('another scope')
  })
})
