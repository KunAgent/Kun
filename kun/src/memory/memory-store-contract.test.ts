import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { HybridMemoryStore } from '../adapters/hybrid/hybrid-memory-store.js'
import type { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import type { ServiceManagerConnection } from '../manager/manager-client.js'
import { KUN_MANAGER_PROTOCOL_VERSION } from '../manager/manager-discovery.js'
import { ManagerRemoteMemoryStore } from '../manager/remote-data-stores.js'
import { ManagerSharedDataStore } from '../manager/shared-data-store.js'
import { buildServiceManagerRouter, ServiceManagerState } from '../manager/service-manager.js'
import { startNodeHttpServer, type NodeHttpServerHandle } from '../server/node-http-server.js'
import { FileMemoryStore, type MemoryStore } from './memory-store.js'

const roots: string[] = []
const policy: MemoryCapabilityConfig = {
  enabled: true,
  scopes: ['user', 'workspace', 'project'],
  maxInjectedRecords: 2
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

for (const adapter of ['file', 'hybrid', 'manager-remote'] as const) {
  describe(`${adapter} MemoryStore contract`, () => {
    it('preserves CRUD, lifecycle, retrieval budgets, traces, and purge semantics', async () => {
      const harness = await createHarness(adapter, policy)
      try {
        const first = await harness.store.createWithId?.('mem_contract_first', {
          content: 'Use pnpm for package management', scope: 'workspace', workspace: '/workspace-a'
        })
        expect(first?.schemaVersion).toBe(2)
        await harness.store.createWithId?.('mem_contract_second', {
          content: 'pnpm workspace package policy', scope: 'workspace', workspace: '/workspace-a'
        })
        await harness.store.createWithId?.('mem_contract_third', {
          content: 'pnpm lockfile convention', scope: 'workspace', workspace: '/workspace-a'
        })
        await harness.store.createWithId?.('mem_contract_unrelated_user', {
          content: 'The user prefers a dark editor theme', scope: 'user', type: 'preference'
        })
        await harness.waitReady?.()

        const retrieved = await harness.store.retrieve({
          query: 'pnpm package workspace', workspace: '/workspace-a', limit: 8
        })
        expect(retrieved).toHaveLength(2)
        expect(retrieved.map((record) => record.id)).not.toContain('mem_contract_unrelated_user')
        harness.store.setLastInjected(retrieved.map((record) => record.id))
        expect((await harness.store.diagnostics()).lastInjectedIds).toEqual(retrieved.map((record) => record.id))

        await harness.store.update('mem_contract_first', { disabled: true }, { workspace: '/workspace-a' })
        expect((await harness.store.retrieve({ query: 'pnpm package', workspace: '/workspace-a', limit: 8 }))
          .map((record) => record.id)).not.toContain('mem_contract_first')
        await harness.store.update('mem_contract_first', { disabled: false }, { workspace: '/workspace-a' })
        await harness.store.delete('mem_contract_first', { workspace: '/workspace-a' })
        expect((await harness.store.list({ workspace: '/workspace-a', includeDeleted: true }))
          .find((record) => record.id === 'mem_contract_first')?.deletedAt).toBeTruthy()
        await harness.store.purge?.('mem_contract_first')
        expect((await harness.store.list({ all: true, includeDeleted: true }))
          .map((record) => record.id)).not.toContain('mem_contract_first')
      } finally {
        await harness.close()
      }
    })
  })
}

describe('Manager memory repository policy reload', () => {
  it('uses one physical repository while enablement, scopes, limits, and diagnostics change live', async () => {
    const root = await tempRoot()
    const manager = await createManagerHarness(join(root, 'data'))
    try {
      const broad = new ManagerRemoteMemoryStore(manager.connection, policy)
      await broad.createWithId('mem_manager_workspace', {
        content: 'workspace alpha memory', scope: 'workspace', workspace: '/workspace-a'
      })
      await broad.createWithId('mem_manager_user', {
        content: 'user alpha memory', scope: 'user'
      })

      const narrow = new ManagerRemoteMemoryStore(manager.connection, {
        enabled: true, scopes: ['user'], maxInjectedRecords: 1
      })
      await expect(narrow.retrieve({ query: 'alpha memory', workspace: '/workspace-a', limit: 8 }))
        .resolves.toMatchObject([{ id: 'mem_manager_user' }])
      const disabled = new ManagerRemoteMemoryStore(manager.connection, {
        enabled: false, scopes: ['user', 'workspace'], maxInjectedRecords: 8
      })
      await expect(disabled.retrieve({ query: 'alpha memory', workspace: '/workspace-a', limit: 8 }))
        .resolves.toEqual([])
      expect(await broad.diagnostics()).toMatchObject({
        canonicalCount: 2,
        indexedCount: 2,
        lastRetrieval: { recordLimit: 0 }
      })
      expect((await readdir(join(root, 'data'))).filter((name) => name === 'memory-index.sqlite3')).toHaveLength(1)
    } finally {
      await manager.close()
    }
  })
})

async function createHarness(adapter: 'file' | 'hybrid' | 'manager-remote', config: MemoryCapabilityConfig): Promise<{
  store: MemoryStore
  waitReady?: () => Promise<void>
  close: () => Promise<void>
}> {
  const root = await tempRoot()
  if (adapter === 'file') {
    return {
      store: new FileMemoryStore({ rootDir: join(root, 'memory'), config }),
      close: async () => undefined
    }
  }
  if (adapter === 'hybrid') {
    const store = new HybridMemoryStore({ dataDir: root, config })
    await store.ready()
    return { store, waitReady: () => store.waitForBackfill(), close: () => store.shutdown() }
  }
  const manager = await createManagerHarness(join(root, 'data'))
  return {
    store: new ManagerRemoteMemoryStore(manager.connection, config),
    close: manager.close
  }
}

async function createManagerHarness(dataDir: string): Promise<{
  connection: ServiceManagerConnection
  close: () => Promise<void>
}> {
  const sharedData = await ManagerSharedDataStore.create(dataDir)
  const router = buildServiceManagerRouter({
    managerToken: 'manager-secret',
    instanceId: 'manager-memory-test',
    startedAt: '2026-08-28T00:00:00.000Z',
    state: new ServiceManagerState(),
    sharedData
  })
  const server: NodeHttpServerHandle = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
  const connection: ServiceManagerConnection = {
    discovery: {
      version: 1,
      protocolVersion: KUN_MANAGER_PROTOCOL_VERSION,
      instanceId: 'manager-memory-test',
      pid: process.pid,
      startedAt: '2026-08-28T00:00:00.000Z',
      host: '127.0.0.1',
      port: server.port,
      baseUrl: `http://127.0.0.1:${server.port}`,
      managerToken: 'manager-secret',
      serviceVersion: '0.1.0',
      dataDir,
      settingsPath: join(dataDir, 'settings.json')
    }
  }
  return {
    connection,
    close: async () => { await server.close(); await sharedData.close() }
  }
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-memory-contract-'))
  roots.push(root)
  return root
}
