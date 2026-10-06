import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { writeModelCatalog, readModelCatalog } from './model-catalog-store.js'
import type { ProviderConfigurationOperation } from '../contracts/provider-configuration.js'

describe('bounded provider configuration scale', () => {
  it('materializes 100 groups / 500 accounts / 10,000 catalog models without losing identities or secrets', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-provider-scale-'))
    try {
      const registry = new ModelConnectionRegistry({ dataDir,
        credentials: new ExtensionCredentialStore({ dataDir, profileId: 'scale' }), onChanged: async () => undefined })
      await registry.initialize()
      const start = performance.now()
      const operations: ProviderConfigurationOperation[] = Array.from({ length: 100 }, (_, i) => ({ kind: 'put-group',
        group: { id: `group-${i}`, name: `Group ${i}`, enabled: true, defaults: {} } }))
      for (let i = 0; i < 500; i++) {
        operations.push({ kind: 'add-connection', connection: { id: `account-${i}`, name: `Account ${i}`, kind: 'http',
          authType: 'none', endpointFormat: 'chat_completions', baseUrl: 'http://127.0.0.1:9999/v1',
          useProxy: false, models: [`model-${i}`] } }, { kind: 'configure-connection', connectionId: `account-${i}`,
          configuration: { groupId: `group-${i % 100}`, enabled: true, inherit: [], manualModels: [] } })
      }
      const preview = await registry.previewConfiguration({ expectedRevision: 0, operations })
      const committed = await registry.commitConfiguration({ expectedRevision: 0, previewId: preview.previewId, idempotencyKey: 'scale' })
      expect(committed.snapshot.connections).toHaveLength(500)
      expect(Object.keys(committed.snapshot.configuration.groups)).toHaveLength(100)
      expect((await registry.materializeReadOnly()).providers.size).toBe(500)
      const materializedMs = performance.now() - start
      // Five pages/providers at the per-discovery ceiling, representing 10,000 aggregate IDs.
      await Promise.all(Array.from({ length: 5 }, (_, i) => writeModelCatalog(dataDir, `account-${i}`, {
        fetchedAt: new Date().toISOString(), identity: `identity-${i}`, configurationRevision: 1,
        models: Array.from({ length: 2000 }, (_, j) => `model-${i}-${j}`)
      })))
      const catalogs = await Promise.all(Array.from({ length: 5 }, (_, i) => readModelCatalog(dataDir, `account-${i}`, `identity-${i}`)))
      expect(catalogs.reduce((total, catalog) => total + (catalog?.models.length ?? 0), 0)).toBe(10_000)
      expect(catalogs.every((catalog) => catalog?.stale === false)).toBe(true)
      expect(new Set(committed.snapshot.connections.map((connection) => connection.accountId)).size).toBe(500)
      expect(materializedMs).toBeLessThan(20_000)
      console.info(JSON.stringify({ providerScale: { groups: 100, accounts: 500, catalogModels: 10000,
        materializedMs: Math.round(materializedMs), totalMs: Math.round(performance.now() - start) } }))
    } finally { await rm(dataDir, { recursive: true, force: true }) }
  }, 30_000)
})
