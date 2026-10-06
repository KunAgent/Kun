import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { emptyDocument } from './model-connection-registry-core.js'
import { LEGACY_PROVIDER_REGISTRY_FILE, PROVIDER_REGISTRY_FILE } from './provider-registry-migration.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function legacyFixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-provider-startup-'))
  roots.push(dataDir)
  const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'test' })
  const credentialRef = 'cred_preserved-startup'
  await credentials.set(credentialRef, { apiKey: 'preserved-key' })
  const legacy = {
    ...emptyDocument(), schemaVersion: 1, revision: 19,
    profiles: { provider: {
      id: 'provider', accountId: 'preserved-account', name: 'Provider', kind: 'http',
      authType: 'api-key', baseUrl: 'https://provider.test/v1',
      endpointFormat: 'chat_completions', useProxy: false, configured: true,
      models: ['saved-model'], selectedModel: 'saved-model', credentialRef,
      customHeaders: { 'X-Team': 'private-team' }
    } },
    tombstones: { removed: { deletedRevision: 18 } },
    defaultProviderId: 'provider', defaultAccountId: 'preserved-account', defaultModel: 'saved-model'
  }
  const legacyText = JSON.stringify(legacy)
  await writeFile(join(dataDir, LEGACY_PROVIDER_REGISTRY_FILE), legacyText)
  return { dataDir, credentials, legacyText,
    registry: new ModelConnectionRegistry({ dataDir, credentials }) }
}

describe('provider migration before Main credential reads', () => {
  it('preserves credentials, account, selection and deletions before Runtime initializes', async () => {
    const f = await legacyFixture()
    expect(await f.registry.credentialStateForInternalConsumer('provider')).toEqual({
      authoritative: true, apiKey: 'preserved-key'
    })
    const runtime = new ModelConnectionRegistry({ dataDir: f.dataDir, credentials: f.credentials })
    const snapshot = await runtime.initialize([{ id: 'removed', name: 'Stale deleted provider',
      kind: 'http', authType: 'api-key', baseUrl: 'https://provider.test/v1', models: ['saved-model'],
      expectedRevision: 19, endpointFormat: 'chat_completions', probe: false, select: false }])
    expect(snapshot).toMatchObject({ defaultProviderId: 'provider', defaultAccountId: 'preserved-account',
      defaultModel: 'saved-model' })
    expect(snapshot.providers).toEqual([expect.objectContaining({ id: 'provider',
      accountId: 'preserved-account', configured: true, credentialStatus: 'ready' })])
    expect(await runtime.getCustomHeaders('provider')).toEqual({ 'X-Team': 'private-team' })
    const canonical = await readFile(join(f.dataDir, PROVIDER_REGISTRY_FILE), 'utf8')
    expect(canonical).not.toContain('preserved-key')
    expect(canonical).not.toContain('private-team')
    expect(await readFile(join(f.dataDir, LEGACY_PROVIDER_REGISTRY_FILE), 'utf8')).toBe(f.legacyText)
  })

  it('migrates even when the first requested provider does not exist', async () => {
    const f = await legacyFixture()
    expect(await f.registry.credentialStateForInternalConsumer('unknown')).toEqual({
      authoritative: false, apiKey: ''
    })
    expect(await f.registry.resolveApiKey('model-connection:provider')).toEqual({ apiKey: 'preserved-key' })
    expect((await f.registry.snapshot()).defaultModel).toBe('saved-model')
  })

  it('keeps an existing v2 credential removal authoritative over the v1 recovery file', async () => {
    const f = await legacyFixture()
    await f.registry.initialize()
    const path = join(f.dataDir, PROVIDER_REGISTRY_FILE)
    const document = JSON.parse(await readFile(path, 'utf8'))
    delete document.profiles.provider.credentialRef
    document.profiles.provider.configured = false
    document.revision += 1
    await writeFile(path, JSON.stringify(document))
    const main = new ModelConnectionRegistry({ dataDir: f.dataDir, credentials: f.credentials })
    expect(await main.credentialStateForInternalConsumer('provider')).toEqual({ authoritative: true, apiKey: '' })
    expect((await main.snapshot()).providers[0]).toMatchObject({ configured: false, credentialStatus: 'missing' })
  })
})
