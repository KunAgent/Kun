import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { AgentMemoryService, AGENT_MEMORY_SCRUB_INTERVAL_MS } from './agent-memory-service.js'
import { AgentMemoryCoordinator } from './agent-memory-coordinator.js'
import { executeMemoryLifecycleOperation } from '../manager/memory-lifecycle-owner.js'
import { ServiceManagerHttpError } from '../manager/usage-errors.js'
import type { AgentIdentityService } from './agent-identity-service.js'
import type { AgentMemoryCapture, AgentMemoryCandidate } from './agent-memory-capture-types.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import type { MemoryCreateRequest } from '../contracts/memory.js'
import { FileMemoryStore } from '../memory/memory-store.js'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'

const resources: Array<{ root: string; store: SqliteRoomStore }> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const { root, store } of resources.splice(0)) {
    await store.close(); await rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-memory-scrub-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  resources.push({ root, store })
  let now = 1_000_000
  const check = vi.fn(async (_input: MemoryCreateRequest, _id?: string): Promise<boolean> => false)
  const memory = { isForgotten: vi.fn(async (input: MemoryCreateRequest, id?: string) =>
    executeMemoryLifecycleOperation({ isForgotten: check } as unknown as MemoryStore,
      'isForgotten', { input, id }) as Promise<boolean>) } as unknown as MemoryStore
  const service = () => new AgentMemoryService({ store } as unknown as AgentIdentityService, () => memory,
    () => true, () => now)
  const job: AgentMemoryCapture = { id: 'job', phase: 'capture', roomId: 'room', rootRequestId: 'request',
    participantAgentId: 'ada', memberId: 'member', status: 'deferred', attempts: 2, runId: 'run',
    messageIds: [], taskIds: [], sourceSeq: 1, snapshot: {
      input: 'Extraction snapshot', model: 'fixture', observedAt: '2026-10-21T06:13:19.000Z',
      messageIds: [], taskIds: [], comparisonRecords: [], sourceSeq: 1,
      sources: [{ id: 'image-only', kind: 'user', locator: 'room:room/message:image-only',
        itemId: 'image-only', contentHash: 'image-hash', trust: 'explicit-user', excerpt: '' }]
    } }
  const put = async (value: AgentMemoryCapture | AgentMemoryCandidate) => {
    const old = await store.get('agent_memory_job', value.id)
    await store.commit({ requestId: value.id + ':' + (old?.revision ?? 'new'),
      checks: [{ kind: 'agent_memory_job', id: value.id, expectedRevision: old?.revision ?? null }],
      puts: [{ kind: 'agent_memory_job', id: value.id, roomId: value.roomId, value }] })
  }
  await put(job)
  return { root, store, memory, check, job, put, service, advance: (ms = AGENT_MEMORY_SCRUB_INTERVAL_MS) => { now += ms } }
}

it('repairs legacy empty excerpts without losing source identity or repeatedly failing coordinator ticks', async () => {
  const f = await fixture()
  const service = f.service()
  const coordinator = new AgentMemoryCoordinator({ store: f.store, memoryStore: f.memory,
    agentMemory: service } as unknown as RoomRuntimeDeps)
  vi.spyOn(service, 'available').mockResolvedValue(false)
  for (let tick = 0; tick < 3; tick++) await expect(coordinator.tick()).resolves.toBe(false)
  expect(f.memory.isForgotten).toHaveBeenCalledTimes(1)
  const repaired = (await f.store.get<AgentMemoryCapture>('agent_memory_job', 'job'))!.value
  expect(repaired).toMatchObject({ attempts: 2, status: 'deferred' })
  expect(repaired.snapshot!.sources[0]).toEqual({ ...f.job.snapshot!.sources[0], excerpt: undefined })
  await expect(f.service().scrubForgotten()).resolves.toBeUndefined()
  await coordinator.close()
})

it('leaves capture jobs without snapshots alone', async () => {
  const f = await fixture()
  await f.put({ ...f.job, snapshot: undefined, status: 'pending', attempts: 0 })
  await expect(f.service().scrubForgotten()).resolves.toBeUndefined()
  expect(f.memory.isForgotten).not.toHaveBeenCalled()
})

it('repairs legacy candidates and still honors forgetting for an image-only source', async () => {
  const f = await fixture()
  const candidate: AgentMemoryCandidate = { id: 'candidate', phase: 'candidate', roomId: 'room',
    rootRequestId: 'request', participantAgentId: 'ada', status: 'pending', action: 'update',
    runId: 'run', sourceMessageIds: ['image-only'], candidate: { content: 'A durable preference',
      type: 'preference', confidence: 1, importance: .5, tags: [],
      observedAt: f.job.snapshot!.observedAt, sources: f.job.snapshot!.sources } }
  await f.put(candidate)
  const memory = new FileMemoryStore({ rootDir: join(f.root, 'memory'),
    config: MemoryCapabilityConfig.parse({ enabled: true }) })
  const saved = await memory.create({ content: 'A forgotten preference', scope: 'user',
    agentContext: { schemaVersion: 1, agentId: 'ada', sourceConversationId: 'room',
      shared: false, sharedConversationIds: [], sharedProjectRoots: [], locked: false },
    sources: f.job.snapshot!.sources.map((source) => ({ ...source, excerpt: undefined })) })
  await memory.delete(saved.id, { agent: { agentId: 'ada', manage: true } })
  f.check.mockImplementation((input, id) => memory.isForgotten(input, id))
  await expect(f.service().scrubForgotten()).resolves.toBeUndefined()
  expect((await f.store.get('agent_memory_job', 'job'))!.value).toMatchObject({ phase: 'forgotten' })
  expect((await f.store.get('agent_memory_job', 'candidate'))!.value).toMatchObject({ phase: 'forgotten' })
  for (const [input] of vi.mocked(f.memory.isForgotten!).mock.calls) {
    expect(input.sources![0]).toMatchObject({ id: 'image-only', itemId: 'image-only', contentHash: 'image-hash' })
    expect(input.sources![0].excerpt).toBeUndefined()
  }
})

it('isolates permanent Manager failures across restarts, logs identifiers, and retries changed evidence', async () => {
  const f = await fixture(), warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  f.job.snapshot!.sources[0].excerpt = 'Valid text'
  await f.put(f.job)
  await f.put({ ...f.job, id: 'healthy', snapshot: { ...f.job.snapshot!, input: 'Healthy snapshot' } })
  vi.mocked(f.memory.isForgotten!).mockImplementation(async (input) => {
    if (input.content === 'Extraction snapshot') throw new ServiceManagerHttpError(400, 'validation_error', 'bad input', 'PRIVATE BODY')
    return false
  })
  await expect(f.service().scrubForgotten()).resolves.toBeUndefined()
  f.advance()
  await expect(f.service().scrubForgotten()).resolves.toBeUndefined()
  const badCalls = () => vi.mocked(f.memory.isForgotten!).mock.calls.filter(([input]) => input.content === 'Extraction snapshot')
  expect(badCalls()).toHaveLength(1)
  expect(warn).toHaveBeenCalledTimes(1)
  expect(warn.mock.calls[0][1]).toMatchObject({ roomId: 'room', requestId: 'request', runId: 'run', jobId: 'job' })
  expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE BODY')
  expect(vi.mocked(f.memory.isForgotten!).mock.calls.some(([input]) => input.content === 'Healthy snapshot')).toBe(true)
  const row = (await f.store.get<AgentMemoryCapture>('agent_memory_job', 'job'))!.value
  await f.put({ ...row, snapshot: { ...row.snapshot!, input: 'Repaired snapshot' } })
  f.advance()
  await expect(f.service().scrubForgotten()).resolves.toBeUndefined()
  expect(vi.mocked(f.memory.isForgotten!).mock.calls.some(([input]) => input.content === 'Repaired snapshot')).toBe(true)
})

it('backs off transient failures exponentially, caps attempts, and keeps explicit erasure fail closed', async () => {
  const f = await fixture()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(f.memory.isForgotten!).mockRejectedValue(new Error('temporary outage'))
  await expect(f.service().scrubForgotten()).resolves.toBeUndefined()
  await f.service().scrubForgotten()
  expect(f.memory.isForgotten).toHaveBeenCalledTimes(1)
  f.advance(); await f.service().scrubForgotten()
  expect(f.memory.isForgotten).toHaveBeenCalledTimes(2)
  f.advance(); await f.service().scrubForgotten()
  expect(f.memory.isForgotten).toHaveBeenCalledTimes(2)
  f.advance(); await f.service().scrubForgotten()
  expect(f.memory.isForgotten).toHaveBeenCalledTimes(3)
  f.advance(24 * 60 * 60_000); await f.service().scrubForgotten()
  expect(f.memory.isForgotten).toHaveBeenCalledTimes(3)
  await expect(f.service().scrubForgotten({ force: true })).rejects.toThrow('temporary outage')
})
