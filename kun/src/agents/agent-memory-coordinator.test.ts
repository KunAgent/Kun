import { afterEach, expect, it, vi } from 'vitest'
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
async function fixture(compare = false, damaged = false, variant?: 'related' | 'related-bad-score') {
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
    const existingId = source.existing[0]?.id as string | undefined
    const base = {
      content: 'Reports use Chinese and include source links.', type: 'preference', confidence: .9, importance: .7,
      tags: [], sourceIds: [source.sources[0].id], durability: 'durable'
    }
    const candidates = variant && existingId ? [
      variant === 'related'
        ? { ...base, comparisons: [{ memoryId: existingId, relation: 'related', reason: 'Feels related to the earlier preference.' }] }
        : { ...base, confidence: 'high', comparisons: [{ memoryId: existingId, relation: 'related' }] }
    ] : damaged && existingId ? [
      { ...base, comparisons: [{ memoryId: existingId, relation: 'supersede', reason: 'Replaces the earlier reporting preference.' }] },
      { ...base, content: 'Reports should link every source inline.', comparisons: [
        { memoryId: existingId, relation: 'supersede', reason: 'Also replaces the earlier reporting preference.' },
        { memoryId: 'unrelated-memory', relation: 'replace' }
      ] }
    ] : [{ ...base, comparisons: compare && existingId ? [{
      memoryId: existingId, relation: 'update', reason: 'Consolidate new reporting preference.'
    }] : [] }]
    yield { kind: 'assistant_text_delta', text: JSON.stringify({ candidates }) }
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
  return { store, memory, agents, actor, capture, room, publish, sourceMessageId: sent.message.id, calls: () => calls }
}
afterEach(async () => {
  vi.restoreAllMocks()
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


it('leaves a conflicting inference pending instead of overwriting a user-locked correction', async () => {
  const f = await fixture(true)
  const existing = await f.memory.create(f.actor.id, { clientRequestId: 'user-correction', conversationId: f.room.id,
    sourceMessageIds: [f.sourceMessageId], content: 'Reports must use Chinese and preserve complete source links.', type: 'preference' })
  expect(existing.memory.agentContext?.locked).toBe(true)
  await f.capture.tick()
  await f.publish('response-after-correction')
  await f.capture.tick(); await setImmediate(); await f.capture.tick()
  const actual = await f.memory.find(f.actor.id, existing.memory.id)
  expect(actual.content).toBe(existing.memory.content)
  expect(actual.agentContext?.locked).toBe(true)
  expect(actual.authority).toBe('reference')
  const proposals = await f.store.list<import('./agent-memory-capture-types.js').AgentMemoryCandidate>('agent_memory_job', { phase: 'candidate' })
  expect(proposals).toHaveLength(1)
  expect(proposals[0]!.value).toMatchObject({ status: 'pending', reason: 'user_locked', targetId: existing.memory.id })
  expect(proposals[0]!.value.candidate.consolidation?.sourceMemoryIds).toContain(existing.memory.id)
})

it('routes a damaged-comparison candidate to review instead of dropping it, while a valid supersede stays pending', async () => {
  const f = await fixture(false, true)
  const existing = await f.memory.create(f.actor.id, { clientRequestId: 'earlier-preference', conversationId: f.room.id,
    sourceMessageIds: [f.sourceMessageId], content: 'Reports must use Chinese and preserve complete source links.', type: 'preference' })
  await f.capture.tick()
  await f.publish('response-after-preference')
  await f.capture.tick(); await setImmediate(); await f.capture.tick()
  // The existing memory is neither overwritten nor superseded automatically.
  const actual = await f.memory.find(f.actor.id, existing.memory.id)
  expect(actual.content).toBe(existing.memory.content)
  // Neither candidate was written as an automatic new memory either.
  expect((await f.memory.list(f.actor.id, {})).memories).toHaveLength(1)
  const proposals = await f.store.list<import('./agent-memory-capture-types.js').AgentMemoryCandidate>('agent_memory_job', { phase: 'candidate' })
  expect(proposals).toHaveLength(2)
  // The clean supersede candidate is waiting for review as before.
  const supersede = proposals.find((row) => row.value.action === 'supersede')
  expect(supersede?.value).toMatchObject({ status: 'pending', targetId: existing.memory.id })
  // The damaged candidate is held for review too, with the quarantined
  // relation named in its reason; its content survives for the reviewer.
  const held = proposals.find((row) => row.value.action === 'create')
  expect(held?.value.status).toBe('pending')
  expect(held?.value.reason).toContain('invalid-relation')
  expect(held?.value.reason).toContain("'replace'")
  expect(held?.value.candidate.content).toBe('Reports should link every source inline.')
  // The run completes and its record keeps the routed-to-review diagnostic.
  const runs = await f.store.list<RoomRunRecord>('room_run', { phase: 'memory' })
  expect(runs).toHaveLength(1)
  expect(runs[0].value.status).toBe('completed')
  expect(runs[0].value.reason).toContain('0 saved; 2 need review')
  expect(runs[0].value.reason).toContain('routed 1 candidate(s) to review')
  expect(runs[0].value.reason).toContain("'replace'")
})

it('holds a candidate with an out-of-enum relation for review instead of saving or dropping it', async () => {
  const f = await fixture(false, false, 'related')
  const existing = await f.memory.create(f.actor.id, { clientRequestId: 'earlier-preference', conversationId: f.room.id,
    sourceMessageIds: [f.sourceMessageId], content: 'Reports must use Chinese and preserve complete source links.', type: 'preference' })
  await f.capture.tick()
  await f.publish('response-after-preference')
  await f.capture.tick(); await setImmediate(); await f.capture.tick()
  // Nothing was auto-saved: only the pre-existing memory is in the store.
  expect((await f.memory.list(f.actor.id, {})).memories).toHaveLength(1)
  const proposals = await f.store.list<import('./agent-memory-capture-types.js').AgentMemoryCandidate>('agent_memory_job', { phase: 'candidate' })
  expect(proposals).toHaveLength(1)
  expect(proposals[0]!.value).toMatchObject({ status: 'pending', action: 'create' })
  expect(proposals[0]!.value.reason).toContain('invalid-relation')
  expect(proposals[0]!.value.reason).toContain("'related'")
  expect(proposals[0]!.value.reason).toContain('#0')
  const runs = await f.store.list<RoomRunRecord>('room_run', { phase: 'memory' })
  expect(runs).toHaveLength(1)
  expect(runs[0].value.reason).toContain('0 saved; 1 need review')
  expect(runs[0].value.reason).toContain('routed 1 candidate(s) to review')
  expect(runs[0].value.reason).toContain("'related'")
})

it('still drops a candidate that is invalid outside its comparisons', async () => {
  const f = await fixture(false, false, 'related-bad-score')
  const existing = await f.memory.create(f.actor.id, { clientRequestId: 'earlier-preference', conversationId: f.room.id,
    sourceMessageIds: [f.sourceMessageId], content: 'Reports must use Chinese and preserve complete source links.', type: 'preference' })
  await f.capture.tick()
  await f.publish('response-after-preference')
  await f.capture.tick(); await setImmediate(); await f.capture.tick()
  expect((await f.memory.list(f.actor.id, {})).memories).toHaveLength(1)
  const proposals = await f.store.list<import('./agent-memory-capture-types.js').AgentMemoryCandidate>('agent_memory_job', { phase: 'candidate' })
  expect(proposals).toHaveLength(0)
  const runs = await f.store.list<RoomRunRecord>('room_run', { phase: 'memory' })
  expect(runs).toHaveLength(1)
  expect(runs[0].value.reason).toContain('dropped 1 invalid extraction candidate')
})

it('does not report a capture job blocked on its conversation as live work', async () => {
  const f = await fixture()
  await f.publish('old-history')
  await f.capture.tick()
  await f.publish('new-response')
  const [request] = await f.store.list<RoomRequestState>('request', { roomId: f.room.id })
  await f.store.commit({ requestId: 'reopen', checks: [{ kind: 'request', id: request!.id, expectedRevision: request!.revision }],
    puts: [{ kind: 'request', id: request!.id, roomId: f.room.id, value: { ...request!.value, status: 'running' } }] })
  expect(await f.capture.tick()).toBe(false)
  const jobs = await f.store.list<{ status: string }>('agent_memory_job', { phase: 'capture' })
  expect(jobs.map((job) => job.value.status)).toContain('pending')
  expect(f.calls()).toBe(0)
})

it('runs the forgotten-memory scrub at most once per interval unless forced or marked due', async () => {
  let now = 1_000_000
  const memoryStore = { isForgotten: async () => false }
  let lists = 0
  const agents = { store: { list: async () => { lists += 1; return [] } } }
  const { AgentMemoryService: Service, AGENT_MEMORY_SCRUB_INTERVAL_MS } = await import('./agent-memory-service.js')
  const service = new Service(agents as never, () => memoryStore as never, () => true, () => now)
  await service.scrubForgotten()
  expect(lists).toBe(2)
  await service.scrubForgotten()
  expect(lists).toBe(2)
  await service.scrubForgotten({ force: true })
  expect(lists).toBe(4)
  now += AGENT_MEMORY_SCRUB_INTERVAL_MS
  await service.scrubForgotten()
  expect(lists).toBe(6)
})

it('backs off a failing forgotten-memory scrub instead of retrying it on every room tick', async () => {
  let now = 1_000_000, lists = 0, failing = true
  const agents = { store: { list: async () => {
    lists += 1
    if (failing) throw new Error('Kun Service Manager request failed with HTTP 503')
    return []
  } } }
  const { AgentMemoryService: Service, AGENT_MEMORY_SCRUB_RETRY_MS } = await import('./agent-memory-service.js')
  const service = new Service(agents as never, () => ({ isForgotten: async () => false }) as never, () => true, () => now)
  await expect(service.scrubForgotten()).rejects.toThrow('HTTP 503')
  await service.scrubForgotten()
  expect(lists).toBe(1)
  now += AGENT_MEMORY_SCRUB_RETRY_MS
  await expect(service.scrubForgotten()).rejects.toThrow('HTTP 503')
  expect(lists).toBe(2)
  now += AGENT_MEMORY_SCRUB_RETRY_MS
  await service.scrubForgotten()
  expect(lists).toBe(2)
  now += AGENT_MEMORY_SCRUB_RETRY_MS
  failing = false
  await service.scrubForgotten()
  expect(lists).toBe(4)
  await service.scrubForgotten()
  expect(lists).toBe(4)
})

it('keeps capturing memories while the forgotten-memory scrub fails', async () => {
  const f = await fixture()
  vi.spyOn(f.memory, 'scrubForgotten').mockRejectedValue(new Error('Kun Service Manager request failed with HTTP 400'))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await f.capture.tick()
  await f.publish('new-response')
  await f.capture.tick(); await setImmediate(); await f.capture.tick()
  expect(f.calls()).toBe(1)
  expect((await f.memory.list(f.actor.id, {})).memories).toHaveLength(1)
  expect(warn).toHaveBeenCalledWith('[kun] agent memory scrub:', 'Kun Service Manager request failed with HTTP 400')
})
