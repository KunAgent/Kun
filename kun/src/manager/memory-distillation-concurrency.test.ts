import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'
import type { PendingMemoryCandidate } from '../contracts/memory-distillation-runtime.js'
import { MemoryDistillationCoordinator } from '../memory/memory-distillation-coordinator.js'
import { canonicalMemoryHash } from '../memory/memory-record-normalizer.js'
import { startNodeHttpServer } from '../server/node-http-server.js'
import { decideMemoryDistillationCandidate } from '../server/routes/memory-distillation.js'
import { KUN_MANAGER_PROTOCOL_VERSION } from './manager-discovery.js'
import { ManagerRemoteMemoryStore } from './remote-data-stores.js'
import { ManagerRemoteMemoryDistillationPendingStore } from './remote-memory-distillation-pending.js'
import { buildServiceManagerRouter, ServiceManagerState } from './service-manager.js'
import { ManagerSharedDataStore } from './shared-data-store.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function harness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-distillation-manager-'))
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }))
  const data = await ManagerSharedDataStore.create(dataDir)
  cleanup.push(() => data.close())
  const startedAt = new Date().toISOString()
  const router = buildServiceManagerRouter({
    managerToken: 'test-token', instanceId: 'manager-test', startedAt,
    state: new ServiceManagerState(), sharedData: data
  })
  const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
  cleanup.push(() => server.close())
  const manager = { discovery: {
    version: 1 as const, protocolVersion: KUN_MANAGER_PROTOCOL_VERSION,
    instanceId: 'manager-test', pid: process.pid, startedAt,
    host: '127.0.0.1', port: server.port, baseUrl: `http://127.0.0.1:${server.port}`,
    managerToken: 'test-token', serviceVersion: '0.1.0', dataDir, settingsPath: join(dataDir, 'settings.json')
  } }
  const config = { ...DEFAULT_KUN_CAPABILITIES_CONFIG.memory, enabled: true }
  const memory = new ManagerRemoteMemoryStore(manager, config)
  function runtime() {
    const pending = new ManagerRemoteMemoryDistillationPendingStore(manager)
    const coordinator = new MemoryDistillationCoordinator({
      threads: {} as never, model: {} as never, pending,
      memoryStore: () => memory, enabled: () => true
    })
    return { pending, coordinator }
  }
  const candidate = {
    content: 'The user prefers concise release notes.', type: 'preference' as const,
    confidence: 0.9, importance: 0.7, observedAt: startedAt, tags: ['release'],
    sources: [{ id: 'source-user', kind: 'user' as const, trust: 'explicit-user' as const,
      threadId: 'thread', turnId: 'turn', excerpt: 'I prefer concise notes.' }]
  }
  return { dataDir, data, memory, runtime, candidate }
}

async function insert(
  h: Awaited<ReturnType<typeof harness>>,
  runtime: ReturnType<Awaited<ReturnType<typeof harness>>['runtime']>,
  turnId: string,
  proposedAction: PendingMemoryCandidate['proposedAction'] = { action: 'create' }
) {
  await runtime.pending.beginRun('thread', turnId)
  const [candidate] = await runtime.pending.completeRun('thread', turnId, [{
    threadId: 'thread', turnId, target: { scope: 'workspace', workspace: h.dataDir },
    candidate: h.candidate, proposedAction
  }])
  return candidate!
}

describe('Memory distillation through the shared Manager HTTP API', () => {
  it('preserves live extraction and terminal denial across runtime reconnects', async () => {
    const h = await harness()
    const first = h.runtime()
    const second = h.runtime()
    await first.pending.beginRun('thread', 'turn')
    await second.coordinator.ready()
    const [entry] = await first.pending.completeRun('thread', 'turn', [{
      threadId: 'thread', turnId: 'turn', target: { scope: 'workspace', workspace: h.dataDir },
      candidate: h.candidate, proposedAction: { action: 'create' }
    }])
    expect(entry).toBeDefined()
    await first.coordinator.decide(entry!.id, { decision: 'deny' }, h.dataDir)
    await second.pending.beginRun('other-thread', 'other-turn')
    await h.runtime().coordinator.ready()
    expect((await second.pending.get(entry!.id))?.status).toBe('denied')
    await expect(second.coordinator.decide(entry!.id, { decision: 'allow' }, h.dataDir))
      .rejects.toThrow(/already denied/)
    expect(await h.memory.list({ workspace: h.dataDir })).toHaveLength(0)
  })

  it('rejects concurrent equivalent creates from separate runtimes', async () => {
    const h = await harness()
    const first = h.runtime()
    const second = h.runtime()
    const a = await insert(h, first, 'turn-a')
    const b = await insert(h, second, 'turn-b')
    const results = await Promise.allSettled([
      first.coordinator.decide(a.id, { decision: 'allow' }, h.dataDir),
      second.coordinator.decide(b.id, { decision: 'allow' }, h.dataDir)
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await h.memory.list({ workspace: h.dataDir })).toHaveLength(1)
    const statuses = await Promise.all([first.pending.get(a.id), second.pending.get(b.id)])
    expect(statuses.map((entry) => entry!.status).sort()).toEqual(['allowed', 'conflicted'])
  })

  it.each(['update', 'supersede'] as const)('preserves an intervening edit during %s and returns HTTP 409', async (action) => {
    const h = await harness()
    const runtime = h.runtime()
    const original = await h.memory.createWithId('target', {
      content: 'The user prefers long release notes.', scope: 'workspace', workspace: h.dataDir
    })
    const entry = await insert(h, runtime, 'turn', {
      action, memoryId: original.id, targetUpdatedAt: original.updatedAt,
      targetFingerprint: canonicalMemoryHash(original)
    })
    const transition = runtime.pending.transition.bind(runtime.pending)
    vi.spyOn(runtime.pending, 'transition').mockImplementation(async (...args) => {
      const result = await transition(...args)
      if (args[2] === 'applying') {
        await h.memory.update(original.id, { content: 'A newer manual correction.' }, { workspace: h.dataDir })
      }
      return result
    })
    const response = await decideMemoryDistillationCandidate(runtime.coordinator, entry.id,
      new Request(`http://runtime/candidate?workspace=${encodeURIComponent(h.dataDir)}`, {
        method: 'POST', body: JSON.stringify({ decision: 'allow' })
      }))
    expect(response.status).toBe(409)
    expect((await runtime.pending.get(entry.id))?.status).toBe('conflicted')
    const records = await h.memory.list({ workspace: h.dataDir })
    expect(records).toHaveLength(1)
    expect(records[0]!.content).toBe('A newer manual correction.')
    expect(records[0]!.supersededAt).toBeUndefined()
  })

  it('reconciles a committed write after a lost reply without creating a second Memory', async () => {
    const h = await harness()
    const runtime = h.runtime()
    const entry = await insert(h, runtime, 'turn')
    const commit = h.memory.commitDistillation.bind(h.memory)
    const spy = vi.spyOn(h.memory, 'commitDistillation').mockImplementationOnce(async (input) => {
      await commit(input)
      throw new Error('lost Manager reply after commit')
    })
    await expect(runtime.coordinator.decide(entry.id, { decision: 'allow' }, h.dataDir))
      .rejects.toThrow(/lost Manager reply/)
    expect((await runtime.pending.get(entry.id))?.status).toBe('applying')
    spy.mockRestore()
    await h.runtime().coordinator.ready()
    expect((await runtime.pending.get(entry.id))?.status).toBe('allowed')
    expect(await h.memory.list({ workspace: h.dataDir })).toHaveLength(1)
  })
})
