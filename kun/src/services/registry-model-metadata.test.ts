import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import { metadataEvidence, capabilityFieldKnown } from '../contracts/model-metadata-evidence.js'
import { configureManagerAtomicJsonClient } from '../extensions/atomic-json.js'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { emptyDocument, type RegistryDocument, type StoredProfile } from './model-connection-registry-core.js'
import { catalogBinding } from './provider-catalog-operations.js'
import { writeModelCatalog } from './model-catalog-store.js'
import { clearModelMetadataOverride, migrateModelMetadata, withModelObservation } from './model-metadata-resolver.js'
import { resolveRegistryProfileMetadata } from './registry-model-metadata.js'
import { applyOperations } from './provider-configuration-operations.js'

const roots: string[] = []
afterEach(async () => {
  configureManagerAtomicJsonClient(null)
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const cap = (extra: Partial<ModelCapabilityMetadata> = {}): ModelCapabilityMetadata => ({ id: 'fixture-model',
  inputModalities: ['text'], outputModalities: ['text'], messageParts: ['text'], supportsToolCalling: true,
  evidence: metadataEvidence({}, 'adapter'), ...extra })
const configured = () => cap({ contextWindowTokens: 128_000, maxOutputTokens: 4096,
  evidence: metadataEvidence({ contextWindowTokens: 128_000, maxOutputTokens: 4096 }, 'user') })
const profile = (capability: ModelCapabilityMetadata): StoredProfile => ({ id: 'fixture', accountId: 'fixture-account',
  name: 'Fixture', kind: 'http', authType: 'none', baseUrl: 'https://first.example/v1', endpointFormat: 'chat_completions',
  useProxy: false, configured: true, models: ['fixture-model'], selectedModel: 'fixture-model',
  modelCapabilities: { 'fixture-model': capability } })
const readDocument = async (root: string) => JSON.parse(await readFile(join(root, 'model-connections.v2.json'), 'utf8')) as RegistryDocument
async function setup(initial?: RegistryDocument, authenticated = false) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-metadata-registry-')); roots.push(dataDir)
  if (initial) await writeFile(join(dataDir, 'model-connections.v2.json'), JSON.stringify(initial))
  const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'test' })
  const registry = new ModelConnectionRegistry({ dataDir, credentials })
  await registry.initialize()
  if (!initial) await registry.connect({ expectedRevision: 0, id: 'fixture', name: 'Fixture', kind: 'http', authType: authenticated ? 'api-key' : 'none',
    ...(authenticated ? { credential: 'first-fixture-key' } : {}),
    baseUrl: 'https://first.example/v1', endpointFormat: 'chat_completions', useProxy: false,
    models: ['fixture-model'], selectedModel: 'fixture-model', modelCapabilities: { 'fixture-model': configured() }, probe: false, select: true })
  return { registry, dataDir, credentials }
}
async function saveAccountCatalog(registry: ModelConnectionRegistry, dataDir: string, maxInput = 96_000) {
  const { identity, document } = await catalogBinding(registry, 'fixture')
  const provider = { id: 'fixture-model', contextWindowTokens: 128_000, maxInputTokens: maxInput, maxOutputTokens: 2048 }
  const directory = { id: 'fixture-model', contextWindowTokens: 1_000_000, maxInputTokens: 1_000_000, maxOutputTokens: 128_000 }
  await writeModelCatalog(dataDir, 'fixture', { fetchedAt: new Date().toISOString(), identity,
    configurationRevision: document.revision, source: 'provider', models: ['fixture-model'],
    modelProfiles: { 'fixture-model': { ...provider, evidence: metadataEvidence(provider, 'provider') } },
    catalogProfiles: { 'fixture-model': { ...directory, evidence: metadataEvidence(directory, 'catalog') } } })
  await registry.refreshMetadata()
  return identity
}

describe('registry metadata migration and account projection', () => {
  it('backs up pre-migration configuration once and is idempotent across restart', async () => {
    const initial = { ...emptyDocument(), profiles: { fixture: profile(configured()) }, defaultProviderId: 'fixture',
      defaultAccountId: 'fixture-account', defaultModel: 'fixture-model' }
    const { registry, dataDir, credentials } = await setup(initial)
    const backupPath = join(dataDir, 'model-metadata-v1-backup.json')
    const backup = await readFile(backupPath, 'utf8')
    expect(JSON.parse(backup).profiles.fixture.modelCapabilities['fixture-model']).toMatchObject({ contextWindowTokens: 128_000, maxOutputTokens: 4096 })
    expect(JSON.parse(backup).modelMetadataVersion).toBeUndefined()
    const first = await readDocument(dataDir)
    expect(first.modelMetadataVersion).toBe(1)
    expect(first.profiles.fixture.modelCapabilities?.['fixture-model'].metadata?.overrides).toEqual({ contextWindowTokens: 128_000, maxOutputTokens: 4096 })
    const restarted = new ModelConnectionRegistry({ dataDir, credentials })
    await restarted.initialize()
    expect(await readFile(backupPath, 'utf8')).toBe(backup)
    expect((await readDocument(dataDir)).profiles.fixture).toEqual(first.profiles.fixture)
    expect((await registry.snapshot()).defaultModel).toBe('fixture-model')
  })
  it('keeps preferences unchanged while snapshots and Runtime materialization use account limits', async () => {
    const { registry, dataDir, credentials } = await setup()
    await saveAccountCatalog(registry, dataDir)
    const snapshot = await registry.snapshot()
    const metadata = snapshot.providers.find((entry) => entry.id === 'fixture')!.modelCapabilities!['fixture-model']
    expect(metadata).toMatchObject({ contextWindowTokens: 128_000, maxInputTokens: 96_000, maxOutputTokens: 2048 })
    expect(metadata.metadata?.overrides).toEqual({ contextWindowTokens: 128_000, maxOutputTokens: 4096 })
    expect(metadata.metadataResolution?.maxOutputTokens).toMatchObject({ automaticValue: 2048, configuredValue: 4096, effectiveValue: 2048 })
    const runtime = await registry.materializeReadOnly()
    expect(runtime.providers.get('fixture')!.modelCapabilities!['fixture-model']).toMatchObject({ maxInputTokens: 96_000, maxOutputTokens: 2048 })
    const stored = (await readDocument(dataDir)).profiles.fixture.modelCapabilities!['fixture-model']
    expect(stored).toMatchObject({ contextWindowTokens: 128_000, maxOutputTokens: 4096 })
    expect(stored.metadata?.observations.some((row) => row.id === 'connection-provider')).not.toBe(true)
    const restarted = new ModelConnectionRegistry({ dataDir, credentials })
    await restarted.initialize()
    expect((await restarted.snapshot()).providers[0].modelCapabilities!['fixture-model']).toMatchObject({ maxInputTokens: 96_000, maxOutputTokens: 2048 })
  })
  it('does not retain account limits after endpoint identity changes', async () => {
    const { registry, dataDir } = await setup()
    const oldIdentity = await saveAccountCatalog(registry, dataDir)
    const snapshot = await registry.snapshot()
    await registry.patch('fixture', { expectedRevision: snapshot.revision, baseUrl: 'https://second.example/v1' })
    expect((await catalogBinding(registry, 'fixture')).identity).not.toBe(oldIdentity)
    const changed = (await registry.snapshot()).providers[0].modelCapabilities!['fixture-model']
    expect(changed.maxOutputTokens).toBe(4096)
    expect(changed.maxInputTokens).toBeUndefined()
    expect(changed.metadata?.observations.some((row) => row.source === 'provider')).toBe(false)
    const runtime = await registry.materializeReadOnly()
    expect(runtime.providers.get('fixture')!.modelCapabilities!['fixture-model'].maxInputTokens).toBeUndefined()
  })
  it('does not carry old account observations into a replacement credential', async () => {
    const { registry, dataDir } = await setup(undefined, true)
    const oldIdentity = await saveAccountCatalog(registry, dataDir)
    await registry.replaceCredential('fixture', { expectedRevision: (await registry.snapshot()).revision, credential: 'second-fixture-key' })
    expect((await catalogBinding(registry, 'fixture')).identity).not.toBe(oldIdentity)
    const current = (await registry.snapshot()).providers[0]
    expect(current.models).toEqual(['fixture-model'])
    expect(current.modelCapabilities!['fixture-model'].maxInputTokens).toBeUndefined()
    expect(current.modelCapabilities!['fixture-model'].metadata?.overrides.maxOutputTokens).toBe(4096)
    expect((await registry.materializeReadOnly()).providers.get('fixture')!.modelCapabilities!['fixture-model'].maxOutputTokens).toBe(4096)
  })
  it('replaces an old projected provider observation when a successful catalog no longer includes it', async () => {
    const { registry, dataDir } = await setup()
    const identity = await saveAccountCatalog(registry, dataDir)
    const projected = (await registry.snapshot()).providers[0].modelCapabilities!['fixture-model']
    const current = await catalogBinding(registry, 'fixture')
    await writeModelCatalog(dataDir, 'fixture', { fetchedAt: new Date().toISOString(), identity,
      configurationRevision: current.document.revision, source: 'provider', models: [], modelProfiles: {}, lastAttemptStatus: 'success' })
    const resolved = await resolveRegistryProfileMetadata(registry, profile(projected))
    expect(resolved.models).toEqual(['fixture-model'])
    expect(resolved.modelCapabilities!['fixture-model'].maxInputTokens).toBeUndefined()
  })
  it('treats identityless or old-account provider facts as history, not current capabilities', async () => {
    const { registry } = await setup()
    for (const scope of [undefined, 'previous-account']) {
      const historical = migrateModelMetadata(cap({ maxInputTokens: 900_000,
        evidence: { maxInputTokens: { source: 'provider', status: 'declared', ...(scope ? { scope } : {}) } } }))
      const resolved = await resolveRegistryProfileMetadata(registry, profile(historical))
      const model = resolved.modelCapabilities!['fixture-model']
      expect(model.maxInputTokens).toBeUndefined()
      expect(capabilityFieldKnown(model, 'maxInputTokens')).toBe(false)
    }
  })
  it('lets an explicit clear suppress a global user preference while retaining automatic observations', async () => {
    const { dataDir, credentials } = await setup()
    const global = cap({ maxOutputTokens: 4096, evidence: metadataEvidence({ maxOutputTokens: 4096 }, 'user') })
    const registry = new ModelConnectionRegistry({ dataDir, credentials, modelCapabilities: () => global })
    const { identity, document } = await catalogBinding(registry, 'fixture')
    await writeModelCatalog(dataDir, 'fixture', { fetchedAt: new Date().toISOString(), identity,
      configurationRevision: document.revision, source: 'manual', models: ['fixture-model'],
      catalogProfiles: { 'fixture-model': { maxOutputTokens: 128_000 } } })
    const automatic = withModelObservation(cap(), { id: 'directory', source: 'catalog', match: 'exact', values: { maxOutputTokens: 128_000 } }) as ModelCapabilityMetadata
    const inherited = await resolveRegistryProfileMetadata(registry, profile(automatic))
    expect(inherited.modelCapabilities!['fixture-model'].maxOutputTokens).toBe(4096)
    const cleared = clearModelMetadataOverride(inherited.modelCapabilities!['fixture-model'], 'maxOutputTokens') as ModelCapabilityMetadata
    const resolved = await resolveRegistryProfileMetadata(registry, profile(cleared))
    expect(resolved.modelCapabilities!['fixture-model'].metadata?.overrides.maxOutputTokens).toBeUndefined()
    expect(resolved.modelCapabilities!['fixture-model'].maxOutputTokens).toBe(128_000)
  })
  it('keeps identityless directory imports as suggestions rather than applying them to a changed endpoint', async () => {
    const { registry } = await setup()
    const historical = withModelObservation(cap(), { id: 'models.dev:old-product', source: 'catalog',
      match: 'exact', values: { contextWindowTokens: 1_000_000, maxInputTokens: 900_000 } })
    const resolved = await resolveRegistryProfileMetadata(registry, profile(historical as ModelCapabilityMetadata))
    const model = resolved.modelCapabilities!['fixture-model']
    expect(model.contextWindowTokens).toBeUndefined()
    expect(model.maxInputTokens).toBeUndefined()
    expect(model.metadata?.observations.find((row) => row.id === 'models.dev:old-product')?.match).toBe('family')
  })
  it('sets and clears only requested override fields through configuration operations', () => {
    const automatic = withModelObservation(cap(), { id: 'directory', source: 'catalog', match: 'exact',
      values: { contextWindowTokens: 1_000_000, maxOutputTokens: 128_000 } }) as ModelCapabilityMetadata
    const initial = { ...emptyDocument(), profiles: { fixture: profile(automatic) } }
    const changed = applyOperations(initial, [{ kind: 'set-model-overrides', connectionId: 'fixture', modelId: 'fixture-model',
      values: { maxOutputTokens: 4096 } }])
    expect(changed.profiles.fixture.modelCapabilities!['fixture-model'].metadata?.overrides).toEqual({ maxOutputTokens: 4096 })
    expect(initial.profiles.fixture.modelCapabilities!['fixture-model'].metadata?.overrides).toEqual({})
    const cleared = applyOperations(changed, [{ kind: 'clear-model-overrides', connectionId: 'fixture', modelId: 'fixture-model', fields: ['maxOutputTokens'] }])
    expect(cleared.profiles.fixture.modelCapabilities!['fixture-model']).toMatchObject({ contextWindowTokens: 1_000_000, maxOutputTokens: 128_000 })
    expect(cleared.profiles.fixture.modelCapabilities!['fixture-model'].metadata?.overrides).toEqual({})
  })
})
