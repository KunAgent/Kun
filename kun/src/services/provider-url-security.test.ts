import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ProviderDefaultsSchema } from '../contracts/provider-configuration.js'
import { ModelConnectionConnectRequestSchema, ModelConnectionPatchRequestSchema } from '../contracts/model-connections.js'
import { assertProviderConfigurationUrls, ProviderSafeUrlSchema } from '../contracts/provider-safe-url.js'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { emptyDocument } from './model-connection-registry-core.js'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { LEGACY_PROVIDER_REGISTRY_FILE, PROVIDER_REGISTRY_FILE } from './provider-registry-migration.js'
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
const unsafe = ['https://user:private@provider.test/v1', 'https://provider.test/models?api_key=private',
  'https://provider.test/models?access_token=private', 'https://provider.test/models?X-Amz-Signature=private']
describe('secret-free provider URLs and recovery', () => {
  it('uses one contract for new connection, patches, endpoint overrides, templates and discovery URLs', () => {
    for (const url of unsafe) {
      expect(ProviderSafeUrlSchema.safeParse(url).success).toBe(false)
      expect(ModelConnectionConnectRequestSchema.safeParse({ expectedRevision: 0, name: 'Provider', baseUrl: url }).success).toBe(false)
      expect(ModelConnectionPatchRequestSchema.safeParse({ expectedRevision: 0, endpoints: { responses: url } }).success).toBe(false)
      expect(ProviderDefaultsSchema.safeParse({ baseUrl: url }).success).toBe(false)
      expect(ProviderDefaultsSchema.safeParse({ discovery: { mode: 'custom', modelsUrl: url } }).success).toBe(false)
      expect(() => assertProviderConfigurationUrls({ profiles: { source: { baseUrl: url } } })).toThrow('protected recovery source')
    }
    expect(ProviderSafeUrlSchema.parse('https://provider.test/v1?api-version=2026-01-01')).toContain('api-version')
    expect(ProviderSafeUrlSchema.parse('https://provider.test/models?page_token=page-2')).toContain('page_token')
  })
  it('preserves a private recovery source and never publishes an unsafe legacy URL in v2', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-secret-url-')); dirs.push(dataDir)
    const raw = JSON.stringify({ ...emptyDocument(), schemaVersion: 1, profiles: { source: {
      id: 'source', accountId: 'account', name: 'Provider', kind: 'http', authType: 'api-key',
      baseUrl: unsafe[0], endpointFormat: 'chat_completions', useProxy: false, configured: false, models: []
    } } })
    const path = join(dataDir, LEGACY_PROVIDER_REGISTRY_FILE)
    await writeFile(path, raw, { mode: 0o644 })
    const registry = new ModelConnectionRegistry({ dataDir, credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' }) })
    await expect(registry.initialize()).rejects.toThrow('protected recovery source')
    expect(await readFile(path, 'utf8')).toBe(raw)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    await expect(readFile(join(dataDir, PROVIDER_REGISTRY_FILE), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('refuses an already existing unsafe v2 before it can appear in bulk snapshots', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-secret-v2-url-')); dirs.push(dataDir)
    await writeFile(join(dataDir, PROVIDER_REGISTRY_FILE), JSON.stringify({ ...emptyDocument(), profiles: { source: {
      id: 'source', accountId: 'account', name: 'Provider', kind: 'http', authType: 'api-key', baseUrl: unsafe[1],
      endpointFormat: 'chat_completions', useProxy: false, configured: false, models: []
    } } }), { mode: 0o600 })
    const registry = new ModelConnectionRegistry({ dataDir, credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' }) })
    await expect(registry.snapshot()).rejects.toThrow('protected recovery source')
  })
})
