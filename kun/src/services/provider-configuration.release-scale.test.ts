import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { ProviderRequestScheduler } from './provider-request-scheduler.js'
import { writeModelCatalog, readModelCatalog } from './model-catalog-store.js'
import { probeConnectionCatalog } from './provider-catalog-operations.js'
import { PROVIDER_REGISTRY_FILE } from './provider-registry-migration.js'
import type { ProviderConfigurationOperation } from '../contracts/provider-configuration.js'

// Fixed admission limits are part of the measured workload, never disabled to
// pass the gate. Credential reads exercise the encrypted backend, not anonymous
// accounts or a mocked in-memory store. Fixture construction is measured apart.
it('measures the release workload with 500 protected accounts, 100 groups and 10,000 catalog models', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-provider-release-scale-'))
  const server = createServer((request, response) => {
    if (request.url === '/slow/models') return
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: Array.from({ length: 2000 }, (_, index) => ({ id: `discovered-${index}` })) }))
  })
  await new Promise<void>((accept) => server.listen(0, '127.0.0.1', accept))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const started = performance.now()
  const metrics: Record<string, number> = {}
  const measure = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    const before = performance.now()
    const value = await operation()
    metrics[name] = Math.round(performance.now() - before)
    return value
  }
  try {
    const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'release-scale' })
    const registry = new ModelConnectionRegistry({ dataDir, credentials, onChanged: async () => undefined })
    await registry.initialize()
    const operations: ProviderConfigurationOperation[] = Array.from({ length: 100 }, (_, index) => ({
      kind: 'put-group', group: { id: `group-${index}`, name: `Group ${index}`, enabled: true, defaults: {} }
    }))
    for (let index = 0; index < 500; index++) {
      operations.push({ kind: 'add-connection', connection: { id: `account-${index}`, name: `Account ${index}`,
        kind: 'http', authType: 'none', baseUrl: `${endpoint}/v1`, endpointFormat: 'chat_completions',
        useProxy: false, models: [`model-${index}`] } }, { kind: 'configure-connection', connectionId: `account-${index}`,
        configuration: { groupId: `group-${index % 100}`, enabled: true, inherit: [], manualModels: [] } })
    }
    const preview = await registry.previewConfiguration({ expectedRevision: 0, operations })
    await registry.commitConfiguration({ expectedRevision: 0, previewId: preview.previewId, idempotencyKey: 'scale-fixture' })
    const path = join(dataDir, PROVIDER_REGISTRY_FILE)
    const document = JSON.parse(await readFile(path, 'utf8'))
    for (let index = 0; index < 500; index++) {
      const reference = `cred_release-scale-${index}`
      await credentials.set(reference, { apiKey: `fake-local-only-key-${index}` })
      Object.assign(document.profiles[`account-${index}`], { authType: 'api-key', credentialRef: reference, configured: true })
    }
    document.profiles['account-499'].baseUrl = `${endpoint}/slow`
    await writeFile(path, JSON.stringify(document), { mode: 0o600 })
    metrics.fixtureConstructionMs = Math.round(performance.now() - started)
    const restarted = new ModelConnectionRegistry({ dataDir, credentials, onChanged: async () => undefined })
    await measure('startupMs', () => restarted.initialize())
    const snapshot = await measure('listMs', () => restarted.configurationSnapshot())
    expect(snapshot.connections).toHaveLength(500)
    expect(snapshot.connections.every((profile) => profile.credentialStatus === 'ready')).toBe(true)
    await measure('searchMs', async () => {
      const current = await restarted.configurationSnapshot()
      expect(current.connections.filter((profile) => profile.name.includes('Account 49')).length).toBe(11)
    })
    const materialized = await measure('materializeMs', () => restarted.materializeReadOnly())
    expect(materialized.providers.size).toBe(500)
    await measure('discoveryMs', async () => {
      expect((await probeConnectionCatalog(restarted, 'account-0')).models).toHaveLength(2000)
    })
    await measure('catalogWriteReadMs', async () => {
      for (let index = 0; index < 5; index++) await writeModelCatalog(dataDir, `account-${index}`, {
        fetchedAt: new Date().toISOString(), identity: `scale-${index}`, configurationRevision: 1,
        models: Array.from({ length: 2000 }, (_, model) => `catalog-${index}-${model}`)
      })
      const catalogs = await Promise.all(Array.from({ length: 5 }, (_, index) => readModelCatalog(dataDir, `account-${index}`, `scale-${index}`)))
      expect(catalogs.reduce((total, catalog) => total + (catalog?.models.length ?? 0), 0)).toBe(10000)
    })
    await measure('discoveryCancelMs', async () => {
      const controller = new AbortController()
      const pending = probeConnectionCatalog(restarted, 'account-499', controller.signal)
      setTimeout(() => controller.abort(new Error('release-scale cancellation')), 20)
      await expect(pending).rejects.toThrow('cancellation')
    })
    await measure('queueCancelMs', async () => {
      const scheduler = new ProviderRequestScheduler()
      const limits = { maxConcurrent: 1, maxQueued: 32, queueWaitMs: 1000 }
      const release = await scheduler.acquire('account-0', 'active-client', limits, new AbortController().signal)
      const controller = new AbortController()
      const waiting = scheduler.acquire('account-0', 'queued-client', limits, controller.signal)
      controller.abort(new Error('release-scale cancellation'))
      await expect(waiting).rejects.toThrow('cancellation')
      release()
      expect(scheduler.status()).toEqual([])
    })
    const beforeHeap = process.memoryUsage().heapUsed
    const beforeRss = process.memoryUsage().rss
    await measure('repeatedListMs', async () => {
      for (let index = 0; index < 20; index++) await restarted.configurationSnapshot()
    })
    metrics.heapGrowthBytes = Math.max(0, process.memoryUsage().heapUsed - beforeHeap)
    metrics.rssGrowthBytes = Math.max(0, process.memoryUsage().rss - beforeRss)
    const thresholds = { startupMs: 10000, listMs: 5000, searchMs: 5000, materializeMs: 10000,
      discoveryMs: 3000, discoveryCancelMs: 1000, queueCancelMs: 1000,
      repeatedListMs: 60000, heapGrowthBytes: 128 * 1024 * 1024, rssGrowthBytes: 128 * 1024 * 1024 }
    for (const [name, maximum] of Object.entries(thresholds)) expect(metrics[name], name).toBeLessThan(maximum)
    const report = { providerReleaseScale: { groups: 100, protectedAccounts: 500,
      catalogModels: 10000, repeatedLists: 20, metrics, thresholds } }
    console.info(JSON.stringify(report))
    if (process.env.KUN_PROVIDER_BENCHMARK_REPORT) await writeFile(process.env.KUN_PROVIDER_BENCHMARK_REPORT, JSON.stringify(report, null, 2))
  } finally {
    server.closeAllConnections()
    await new Promise<void>((accept) => server.close(() => accept()))
    await rm(dataDir, { recursive: true, force: true })
  }
}, 120000)
