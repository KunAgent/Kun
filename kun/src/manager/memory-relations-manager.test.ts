import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { relationBinding } from '../memory/memory-relations.js'
import { startNodeHttpServer } from '../server/node-http-server.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { ManagerRemoteMemoryStore } from './remote-data-stores.js'
import { buildServiceManagerRouter, ServiceManagerState } from './service-manager.js'
import { ManagerSharedDataStore } from './shared-data-store.js'

it('round-trips relation review through the Manager owner and scrubs erased endpoints', async () => {
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
  try {
    const config = MemoryCapabilityConfig.parse({ enabled: true })
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
    await first.lifecycle(target.id, { action: 'erase', expectedRevision: target.revision,
      confirmation: { memoryId: target.id, irreversible: true } })
    expect((await second.relations({ action: 'list', memoryId: source.id, access: {} })).relations).toEqual([])
  } finally {
    await server.close()
    await owner.close()
    await rm(root, { recursive: true, force: true })
  }
})
