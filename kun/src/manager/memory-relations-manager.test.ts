import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { relationBinding } from '../memory/memory-relations.js'
import { startNodeHttpServer } from '../server/node-http-server.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { ManagerRemoteMemoryStore } from './remote-data-stores.js'
import { buildServiceManagerRouter, ServiceManagerState } from './service-manager.js'
import { ManagerSharedDataStore } from './shared-data-store.js'
import { withMemoryMutation } from '../memory/memory-mutation-queue.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-relations-manager-'))
  const dataDir = join(root, 'data')
  const owner = await ManagerSharedDataStore.create(dataDir)
  const startedAt = new Date().toISOString()
  const server = await startNodeHttpServer({
    router: buildServiceManagerRouter({
      managerToken: 'test-token', instanceId: 'relations-test', startedAt,
      state: new ServiceManagerState(), sharedData: owner
    }), host: '127.0.0.1', port: 0
  })
  const connection: ServiceManagerConnection = { discovery: {
    version: 1, protocolVersion: 6, instanceId: 'relations-test', pid: process.pid,
    startedAt, host: '127.0.0.1', port: server.port, baseUrl: `http://127.0.0.1:${server.port}`,
    managerToken: 'test-token', serviceVersion: '0.4.1', dataDir, settingsPath: join(root, 'settings.json')
  } }
  return { root, dataDir, owner, server, connection }
}

it('round-trips relation review through the Manager owner and scrubs erased endpoints', async () => {
  const { root, owner, server, connection } = await fixture()
  try {
    const config = MemoryCapabilityConfig.parse({ enabled: true, relationContextEnabled: true })
    const first = new ManagerRemoteMemoryStore(connection, config)
    const second = new ManagerRemoteMemoryStore(connection, config)
    const source = await first.create({ content: 'Database version 17.', scope: 'user' })
    const target = await first.create({ content: 'Database version 16.', scope: 'user' })
    const proposed = await first.relations({ action: 'propose', access: {}, proposals: [{
      source: relationBinding(source), target: relationBinding(target), kind: 'contradicts',
      sourceEvidence: { start: 0, end: 19 }, targetEvidence: { start: 0, end: 19 }
    }] })
    const id = proposed.relations[0].suggestion.id
    await second.relations({ action: 'review', id, decision: 'accepted', access: {} })
    expect((await first.relations({ action: 'list', memoryId: source.id, access: {} })).relations[0].suggestion.status).toBe('accepted')
    const projection = {
      selected: [source, target].map(({ id, revision, content }) => ({ id, revision, content })),
      access: {}, remainingCharacters: 1600, purpose: 'injection' as const
    }
    expect((await second.relationContext(projection)).annotations).toHaveLength(1)
    const disabled = new ManagerRemoteMemoryStore(connection, MemoryCapabilityConfig.parse({ enabled: true }))
    expect((await disabled.relationContext(projection)).state).toBe('disabled')
    expect((await disabled.relationContext({ ...projection, purpose: 'preview' })).automaticEnabled).toBe(false)
    expect((await second.relationContext(projection)).automaticEnabled).toBe(true)
    await first.lifecycle(target.id, { action: 'erase', expectedRevision: target.revision,
      confirmation: { memoryId: target.id, irreversible: true } })
    expect((await second.relations({ action: 'list', memoryId: source.id, access: {} })).relations).toEqual([])
    expect((await second.relationContext(projection)).annotations).toEqual([])
  } finally {
    await server.close()
    await owner.close()
    await rm(root, { recursive: true, force: true })
  }
})

it.each(['cancel', 'deadline'])('fences queued Manager relation writes after %s', async (reason) => {
  const { root, dataDir, owner, server, connection } = await fixture()
  let release: () => void = () => {}
  try {
    const remote = new ManagerRemoteMemoryStore(connection, MemoryCapabilityConfig.parse({ enabled: true }))
    const source = await remote.create({ content: 'Database version 17.', scope: 'user' })
    const target = await remote.create({ content: 'Database version 16.', scope: 'user' })
    const hold = withMemoryMutation(join(dataDir, 'memory'), () => new Promise<void>((resolve) => { release = resolve }))
    let arrived!: (signal: AbortSignal) => void
    const received = new Promise<AbortSignal>((resolve) => { arrived = resolve })
    const original = owner.executeMemory.bind(owner)
    vi.spyOn(owner, 'executeMemory').mockImplementation((operation, value, signal) => {
      if (operation === 'relations') arrived(signal!)
      return original(operation, value, signal)
    })
    const controller = new AbortController()
    const deadlineAt = Date.now() + 60_000
    const pending = remote.relations({ action: 'propose', access: {}, deadlineAt, proposals: [{
      source: relationBinding(source), target: relationBinding(target), kind: 'contradicts',
      sourceEvidence: { start: 0, end: 19 }, targetEvidence: { start: 0, end: 19 }
    }] }, controller.signal)
    const rejected = expect(pending).rejects.toThrow()
    const ownerSignal = await received
    if (reason === 'cancel') {
      const cancelled = new Promise<void>((resolve) => ownerSignal.addEventListener('abort', () => resolve(), { once: true }))
      controller.abort()
      await cancelled
    } else vi.spyOn(Date, 'now').mockReturnValue(deadlineAt + 1)
    release()
    await hold
    await rejected
    vi.restoreAllMocks()
    expect((await remote.relations({ action: 'list', memoryId: source.id, access: {} })).relations).toEqual([])
  } finally {
    release()
    vi.restoreAllMocks()
    await server.close()
    await owner.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('preserves paging cursors and status filtering across the Manager boundary', async () => {
  const { root, owner, server, connection } = await fixture()
  try {
    const remote = new ManagerRemoteMemoryStore(connection, MemoryCapabilityConfig.parse({ enabled: true }))
    const source = await remote.create({ content: 'Source database.', scope: 'user' })
    for (let i = 0; i < 3; i++) {
      const target = await remote.create({ content: `Target database ${i}.`, scope: 'user' })
      const result = await remote.relations({ action: 'propose', access: {}, proposals: [{
        source: relationBinding(source), target: relationBinding(target), kind: 'extends',
        sourceEvidence: { start: 0, end: 6 }, targetEvidence: { start: 0, end: 6 }
      }] })
      await remote.relations({ action: 'review', id: result.relations[0].suggestion.id, decision: 'accepted', access: {} })
    }
    const first = await remote.relations({ action: 'list', memoryId: source.id, access: {}, limit: 1, status: 'accepted' })
    expect(first.nextCursor).toBeDefined()
    const next = await remote.relations({ action: 'list', memoryId: source.id, access: {}, before: first.nextCursor, status: 'accepted' })
    expect(next.relations).toHaveLength(2)
    expect(next.nextCursor).toBeUndefined()
    expect(next.relations.map((item) => item.suggestion.id)).not.toContain(first.relations[0].suggestion.id)
    expect((await remote.relations({ action: 'list', memoryId: source.id, access: {}, status: 'pending' })).relations).toEqual([])
  } finally {
    await server.close()
    await owner.close()
    await rm(root, { recursive: true, force: true })
  }
})
