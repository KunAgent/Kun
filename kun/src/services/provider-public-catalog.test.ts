import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { refreshPublicCatalogs } from './provider-catalog-operations.js'
import { metadataEvidence } from '../contracts/model-metadata-evidence.js'
const dirs: string[] = []
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

it('warms Runtime public metadata with exact pricing while preserving user limits and prices', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-public-catalog-')); dirs.push(dataDir)
  const registry = new ModelConnectionRegistry({ dataDir, credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' }) })
  await registry.initialize()
  const manual = { id: 'deepseek-chat', inputModalities: ['text'] as const, outputModalities: ['text'] as const,
    messageParts: ['text'] as const, supportsToolCalling: true, contextWindowTokens: 128000, maxOutputTokens: 4096,
    pricing: { inputUsdPerMillion: 9, outputUsdPerMillion: 9 } }
  await registry.connect({ expectedRevision: 0, id: 'deepseek', name: 'DeepSeek', kind: 'http', authType: 'api-key',
    baseUrl: 'https://api.deepseek.com', endpointFormat: 'chat_completions', presetSource: 'deepseek',
    models: ['deepseek-chat'], modelCapabilities: { 'deepseek-chat': { ...manual, evidence: metadataEvidence(manual, 'user') } },
    credential: 'fixture-key', probe: false, select: false })
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toBe('https://models.dev/api.json')
    return Response.json({ deepseek: { models: { 'deepseek-chat': { limit: { context: 256000, input: 200000, output: 128000 },
      cost: { input: 1, output: 2 } } } } }, { headers: { etag: 'first' } })
  }); vi.stubGlobal('fetch', fetcher)
  await refreshPublicCatalogs(registry)
  const snapshot = await registry.snapshot(), model = snapshot.providers[0]?.modelCapabilities?.['deepseek-chat']
  expect(model).toMatchObject({ contextWindowTokens: 128000, maxInputTokens: 128000, maxOutputTokens: 4096,
    pricing: { inputUsdPerMillion: 9, outputUsdPerMillion: 9 } })
  const cached = await registry.catalog('deepseek')
  expect(cached?.catalogProfiles?.['deepseek-chat']).toMatchObject({ contextWindowTokens: 256000, maxInputTokens: 200000,
    pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 2 }, evidence: { pricing: { source: 'catalog', sourceId: 'models.dev:deepseek', match: 'exact', fieldPath: 'cost', observedAt: cached?.publicCatalogFetchedAt } } })
  expect(cached?.evidence?.catalog.status).toBe('unknown')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
