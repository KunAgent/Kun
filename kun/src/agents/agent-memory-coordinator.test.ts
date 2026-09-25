import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { AgentIdentityService } from './agent-identity-service.js'
import { AgentMemoryService } from './agent-memory-service.js'
import { AgentMemoryCoordinator } from './agent-memory-coordinator.js'
import { openAgentConversation } from './agent-conversations.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomService } from '../rooms/room-service.js'
import type { RoomRuntimeDeps, RoomRequestState } from '../rooms/room-runtime-types.js'
import { FileMemoryStore } from '../memory/memory-store.js'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import type { ModelClient } from '../ports/model-client.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'

const resources: Array<{ root: string; store: SqliteRoomStore; capture: AgentMemoryCoordinator }> = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-agent-capture-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  const agents = new AgentIdentityService(store, () => ({}))
  const rooms = new RoomService(store, () => {}); rooms.setAgentDirectory(agents)
  const memoryStore = new FileMemoryStore({ rootDir: join(root, 'memory'), config: MemoryCapabilityConfig.parse({ enabled: true }) })
  const memory = new AgentMemoryService(agents, () => memoryStore)
  const actor = (await agents.create({ clientRequestId: 'a', name: 'Ada' })).agent
  const room = (await openAgentConversation(agents, rooms, actor.id)).room
  const sent = await rooms.send(room.id, { clientRequestId: 'user', body: 'Reports use Chinese and link the source.' })
  const request = (await store.get<RoomRequestState>('request', sent.requestId))!
  await store.commit({ requestId: 'complete', checks: [{ kind: 'request', id: request.id, expectedRevision: request.revision }],
    puts: [{ kind: 'request', id: request.id, roomId: room.id,
    value: { ...request.value, status: 'completed' } }] })
  let calls = 0
  const client: ModelClient = { provider: 'fixture', model: 'fixture', async *stream(input) {
    calls++
    const text = input.history[0]
    const source = JSON.parse('text' in text ? text.text : '{}')
    yield { kind: 'assistant_text_delta', text: JSON.stringify({ candidates: [{
      content: 'Reports use Chinese and include source links.', type: 'preference', confidence: .9, importance: .7,
      tags: [], sourceIds: [source.sources[0].id], durability: 'durable', comparisons: []
    }] }) }
  } }
  const deps = { store, agentMemory: memory, memoryStore, model: () => ({ model: 'fixture' }),
    profiles: () => ({}), peerModels: { client, roles: () => undefined } } as unknown as RoomRuntimeDeps
  const capture = new AgentMemoryCoordinator(deps)
  resources.push({ root, store, capture })
  const publish = async (id: string, overrides: Record<string, unknown> = {}) => store.commit({ requestId: 'publish:' + id,
    checks: [{ kind: 'message', id, expectedRevision: null }],
    puts: [{ kind: 'message', id, roomId: room.id, value: { ...sent.message, id, authorKind: 'member',
      authorMemberId: actor.id, authorAgentId: actor.id, body: 'I will include source links in Chinese reports.',
      sourceRequestId: sent.requestId, clientRequestId: undefined, status: 'final', ...overrides } }],
    events: [{ roomId: room.id, kind: 'message.created', payload: { id } }] })
  return { store, memory, agents, actor, capture, room, publish, calls: () => calls }
}
afterEach(async () => {
  for (const { root, store, capture } of resources.splice(0)) {
    await capture.close(); await store.close(); await rm(root, { recursive: true, force: true })
  }
})

it('captures attributed completed work without waking discussion or reprocessing old history', async () => {
  const f = await fixture()
  await f.publish('old-history')
  await f.capture.tick()
  expect(f.calls()).toBe(0)
  await f.publish('new-response')
  await f.capture.tick(); await setImmediate(); await f.capture.tick()
  expect(f.calls()).toBe(1)
  const memories = (await f.memory.list(f.actor.id, {})).memories
  expect(memories).toHaveLength(1)
  expect(memories[0].memory.agentContext).toMatchObject({ sourceConversationId: f.room.id, shared: false, locked: false })
  const runs = await f.store.list<RoomRunRecord>('room_run', { phase: 'memory' })
  expect(runs).toHaveLength(1)
  expect(runs[0].value.status).toBe('completed')
  const events = await f.store.events('*')
  expect(events.filter((event) => event.kind === 'message.created')).toHaveLength(3)
  await f.capture.tick()
  expect(f.calls()).toBe(1)
})

it('skips proposal presentation cards since they are only drafts', async () => {
  const f = await fixture()
  await f.capture.tick()
  await f.publish('proposal-card', { presentationKind: 'proposal' })
  await f.capture.tick(); await setImmediate(); await f.capture.tick()
  expect(f.calls()).toBe(0)
  expect((await f.memory.list(f.actor.id, {})).memories).toHaveLength(0)
})

it('never captures work after an agent disables automatic memory', async () => {
  const f = await fixture()
  await f.capture.tick()
  await f.agents.update(f.actor.id, { clientRequestId: 'disable', expectedRevision: 0,
    memory: { readEnabled: true, captureEnabled: false } })
  await f.publish('disabled-response')
  await f.capture.tick()
  expect(f.calls()).toBe(0)
  expect((await f.memory.list(f.actor.id, {})).memories).toHaveLength(0)
})
