import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { emptyDocument } from './model-connection-registry-core.js'
import { exportProviderConfiguration } from './provider-configuration-exchange.js'
import { decryptProviderBackup, encryptProviderBackup } from './provider-configuration-backup.js'
import { exportProviderRegistryDowngrade, previewProviderRegistryDowngrade } from './provider-registry-recovery.js'
import { configureManagerAtomicJsonClient } from '../extensions/atomic-json.js'
const folders: string[] = []
afterEach(async () => { configureManagerAtomicJsonClient(null); vi.unstubAllGlobals(); await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-provider-recovery-')); folders.push(dataDir)
  const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'test' })
  const registry = new ModelConnectionRegistry({ dataDir, credentials }); await registry.initialize()
  return { dataDir, credentials, registry }
}
const profile = { id: 'one', name: 'One', kind: 'http', authType: 'api-key', baseUrl: 'https://one.test/v1',
  endpointFormat: 'chat_completions', models: ['coding'], customHeaders: { 'X-Team': 'private-header' },
  credential: 'private-key', probe: false, select: false } as const
async function populated() { const f = await fixture(); await f.registry.connect({ ...profile, expectedRevision: 0 }); return f }
function commitBody(preview: { expectedRevision: number; previewId: string }, bindings: unknown[] = []) {
  return { expectedRevision: preview.expectedRevision, previewId: preview.previewId, idempotencyKey: preview.previewId, bindings }
}
describe('provider protected exchange and recovery', () => {
  it('binds exact secret slots and atomically publishes new identities without exposing secret bytes', async () => {
    const source = await populated(), target = await fixture()
    const exchange = exportProviderConfiguration(await source.registry.configurationSnapshot())
    const preview = await target.registry.previewProviderImport({ ...exchange, expectedRevision: 0 })
    expect(JSON.stringify(preview)).not.toContain('private-key')
    const bindings = [{ slotId: 'one:credential', kind: 'credential', credential: 'import-key' },
      { slotId: 'one:headers', kind: 'headers', headers: { 'X-Team': 'import-header' } }]
    const result = await target.registry.commitProviderImport(commitBody(preview, bindings))
    expect(result.applied).toBe(true)
    expect(await target.registry.credentialForCompatibility('one')).toBe('import-key')
    expect(await target.registry.getCustomHeaders('one')).toEqual({ 'X-Team': 'import-header' })
    const raw = await readFile(join(target.dataDir, 'model-connections.v2.json'), 'utf8')
    expect(raw).not.toContain('import-key'); expect(raw).not.toContain('import-header')
    expect(await target.registry.commitProviderImport(commitBody(preview, bindings))).toMatchObject({ committedRevision: result.committedRevision })
    await expect(target.registry.commitProviderImport(commitBody(preview, [{ ...bindings[0], credential: 'different' }]))).rejects.toThrow('different secret bindings')
  })
  it('binds a protected local account only within the same adapter and host scope', async () => {
    const f = await populated(), before = await f.registry.configurationSnapshot()
    const exchange = exportProviderConfiguration(before)
    const preview = await f.registry.previewProviderImport({ ...exchange, expectedRevision: before.revision })
    const result = await f.registry.commitProviderImport(commitBody(preview, [{ slotId: 'one:credential', kind: 'credential', sourceConnectionId: 'one' }]))
    expect(await f.registry.credentialForCompatibility('one-import-1')).toBe('private-key')
    expect(result.snapshot.connections.find((entry) => entry.id === 'one-import-1')?.accountId).toBe(before.connections[0].accountId)
    const changed = { ...exchange, operations: exchange.operations.map((operation) => operation.kind === 'add-connection'
      ? { ...operation, connection: { ...operation.connection, baseUrl: 'https://other.test/v1' } } : operation) }
    const blocked = await f.registry.previewProviderImport({ ...changed, expectedRevision: result.snapshot.revision })
    await expect(f.registry.commitProviderImport(commitBody(blocked, [{ slotId: 'one:credential', kind: 'credential', sourceConnectionId: 'one' }]))).rejects.toThrow('host scope')
  })
  it('keeps missing slots as drafts and rejects wrong header names or unreviewed slots without a vault write', async () => {
    const source = await populated(), target = await fixture()
    const exchange = exportProviderConfiguration(await source.registry.configurationSnapshot())
    const preview = await target.registry.previewProviderImport({ ...exchange, expectedRevision: 0 })
    const set = vi.spyOn(target.credentials, 'set')
    await expect(target.registry.commitProviderImport(commitBody(preview, [{ slotId: 'one:headers', kind: 'headers', headers: { Authorization: 'bad' } }]))).rejects.toThrow('exactly')
    expect(set).not.toHaveBeenCalled()
    const fresh = await target.registry.previewProviderImport({ ...exchange, expectedRevision: 0 })
    const result = await target.registry.commitProviderImport(commitBody(fresh))
    expect(result.snapshot.connections[0].configured).toBe(false)
  })
  it('recovers from vault failure before publication and collects prepared orphan references', async () => {
    const source = await populated(), target = await fixture()
    const exchange = exportProviderConfiguration(await source.registry.configurationSnapshot())
    const preview = await target.registry.previewProviderImport({ ...exchange, expectedRevision: 0 })
    vi.spyOn(target.credentials, 'set').mockRejectedValueOnce(new Error('vault unavailable'))
    await expect(target.registry.commitProviderImport(commitBody(preview, [{ slotId: 'one:credential', kind: 'credential', credential: 'new-key' }]))).rejects.toThrow('vault unavailable')
    const document = JSON.parse(await readFile(join(target.dataDir, 'model-connections.v2.json'), 'utf8'))
    expect(document.profiles).toEqual({}); expect(document.credentialRefCleanup).toEqual({})
    expect((await target.registry.snapshot()).revision).toBe(0)
  })
  it('recovers a dead import writer after a secret was written and Manager disappeared before publication', async () => {
    const source = await populated(), target = await fixture()
    const exchange = exportProviderConfiguration(await source.registry.configurationSnapshot())
    const preview = await target.registry.previewProviderImport({ ...exchange, expectedRevision: 0 })
    const set = target.credentials.set.bind(target.credentials)
    vi.spyOn(target.credentials, 'set').mockImplementationOnce(async (reference, payload) => {
      await set(reference, payload)
      configureManagerAtomicJsonClient({ baseUrl: 'http://127.0.0.1:1', token: 'test', dataDir: target.dataDir })
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Manager disconnected')))
      throw new Error('writer crashed')
    })
    await expect(target.registry.commitProviderImport(commitBody(preview, [{ slotId: 'one:credential', kind: 'credential', credential: 'orphan-key' }]))).rejects.toThrow('writer crashed')
    const interrupted = JSON.parse(await readFile(join(target.dataDir, 'model-connections.v2.json'), 'utf8'))
    expect(interrupted.profiles).toEqual({})
    const reference = Object.keys(interrupted.credentialRefCleanup)[0]
    expect(reference).toBeTruthy()
    configureManagerAtomicJsonClient(null)
    expect(await target.credentials.get(reference)).toMatchObject({ apiKey: 'orphan-key' })
    const restarted = new ModelConnectionRegistry({ dataDir: target.dataDir, credentials: target.credentials, isProcessAlive: () => false })
    await restarted.initialize()
    expect(await target.credentials.get(reference)).toBeNull()
    expect(JSON.parse(await readFile(join(target.dataDir, 'model-connections.v2.json'), 'utf8')).credentialRefCleanup).toEqual({})
  })
  it('encrypts portable backup with a distinct password key and rejects tampering, wrong password and unsupported versions', async () => {
    const backup = await encryptProviderBackup({ schemaVersion: 2 }, [{ slotId: 'slot', kind: 'credential', credential: 'backup-secret' }], 'long-test-password')
    expect(JSON.stringify(backup)).not.toContain('backup-secret')
    expect(await decryptProviderBackup(backup, 'long-test-password')).toMatchObject({ bindings: [{ credential: 'backup-secret' }] })
    await expect(decryptProviderBackup(backup, 'wrong-test-password')).rejects.toThrow('invalid')
    await expect(decryptProviderBackup({ ...backup, ciphertext: 'AAAA' }, 'long-test-password')).rejects.toThrow('invalid')
    await expect(decryptProviderBackup({ ...backup, version: 2 }, 'long-test-password')).rejects.toThrow()
  })
  it('restores encrypted slots through a reviewed remapped import and bounds preview to the current revision', async () => {
    const source = await populated(), target = await populated()
    const { backup } = await source.registry.exportProviderBackup('long-test-password')
    const snapshot = await target.registry.snapshot()
    const preview = await target.registry.previewProviderBackup({ backup, password: 'long-test-password', expectedRevision: snapshot.revision })
    expect(preview.secretSlots.every((slot) => slot.bound)).toBe(true)
    expect(JSON.stringify(preview)).not.toContain('private-header')
    await target.registry.commitProviderImport(commitBody(preview))
    expect(await target.registry.credentialForCompatibility('one-import-1')).toBe('private-key')
    expect(await target.registry.getCustomHeaders('one-import-1')).toEqual({ 'X-Team': 'private-header' })
  })
  it('retains v1 recovery contents and protects their file permissions before publishing migration origins', async () => {
    const f = await fixture(), legacy = { ...emptyDocument(), schemaVersion: 1, profiles: { one: {
      ...profile, credential: undefined, probe: undefined, select: undefined, accountId: 'stable-account', configured: false, useProxy: false } } }
    await rm(join(f.dataDir, 'model-connections.v2.json'))
    await writeFile(join(f.dataDir, 'model-connections.v1.json'), JSON.stringify(legacy), { mode: 0o644 })
    await f.registry.initialize()
    expect((await stat(join(f.dataDir, 'model-connections.v1.json'))).mode & 0o777).toBe(0o600)
    expect(await readFile(join(f.dataDir, 'model-connections.v1.json'), 'utf8')).toContain('private-header')
    const snapshot = await f.registry.configurationSnapshot()
    expect(snapshot.connections[0].accountId).toBe('stable-account')
    expect(snapshot.configuration.connections.one.migrationOrigin?.schemaVersion).toBe(1)
    expect(exportProviderConfiguration(snapshot).operations.find((operation) => operation.kind === 'configure-connection')).toMatchObject({ configuration: { migrationOrigin: undefined } })
  })
  it('protects adapter-generated headers separately and preserves fresh credential header precedence after restart', async () => {
    const f = await fixture()
    await rm(join(f.dataDir, 'model-connections.v2.json'))
    const legacy = { ...emptyDocument(), schemaVersion: 1, profiles: { one: {
      id: 'one', accountId: 'stable-owner', name: 'One', kind: 'http', authType: 'api-key', baseUrl: 'https://one.test/v1',
      endpointFormat: 'chat_completions', useProxy: false, models: ['coding'], configured: true,
      credentialSourceId: 'settings:provider:one', headers: { 'X-Account': 'old-account-secret' }, customHeaders: { 'X-User': 'user-secret' } } } }
    await writeFile(join(f.dataDir, 'model-connections.v1.json'), JSON.stringify(legacy))
    const registry = new ModelConnectionRegistry({ dataDir: f.dataDir, credentials: f.credentials,
      resolveCredentialSource: async () => ({ apiKey: 'fresh-token', headers: { 'X-Account': 'fresh-account' } }), inspectCredentialSource: async () => 'ready' })
    await registry.initialize()
    const raw = await readFile(join(f.dataDir, 'model-connections.v2.json'), 'utf8')
    expect(raw).not.toContain('old-account-secret'); expect(raw).not.toContain('user-secret')
    const snapshot = await registry.configurationSnapshot()
    expect(snapshot.connections[0]).toMatchObject({ generatedHeaderNames: ['X-Account'], customHeaderNames: ['X-User'] })
    const exchange = exportProviderConfiguration(snapshot)
    expect(exchange.secretSlots).toEqual(expect.arrayContaining([expect.objectContaining({ headerClass: 'adapter', names: ['X-Account'] })]))
    const material = await registry.materializeReadOnly()
    expect(material.providers.get('one')).toMatchObject({ headers: { 'X-Account': 'old-account-secret' }, customHeaders: { 'X-User': 'user-secret' } })
    // Request-time credentials remain separate; the old adapter headers do not become user overrides.
    expect(material.providers.get('one')?.customHeaders).not.toHaveProperty('X-Account')
  })
  it('protects plaintext adapter and user headers already present in canonical v2 and retires replaced protected refs', async () => {
    const f = await populated(), path = join(f.dataDir, 'model-connections.v2.json')
    const original = JSON.parse(await readFile(path, 'utf8'))
    const previousHeaderRef = original.profiles.one.customHeadersRef
    original.profiles.one.headers = { Authorization: 'canonical-old-bearer', 'X-Account': 'canonical-adapter-private' }
    original.profiles.one.customHeaders = { 'X-Custom': 'canonical-custom-private' }
    await writeFile(path, JSON.stringify(original))
    await f.registry.initialize()
    const protectedText = await readFile(path, 'utf8')
    expect(protectedText).not.toContain('canonical-old-bearer')
    expect(protectedText).not.toContain('canonical-adapter-private')
    expect(protectedText).not.toContain('canonical-custom-private')
    const protectedDocument = JSON.parse(protectedText)
    expect(protectedDocument.profiles.one.headersRef).toBeTruthy()
    expect(protectedDocument.profiles.one.headers).toBeUndefined()
    expect(protectedDocument.profiles.one.customHeaders).toBeUndefined()
    expect(await f.registry.getCustomHeaders('one')).toEqual({ 'X-Custom': 'canonical-custom-private' })
    expect(await f.credentials.get(previousHeaderRef)).toBeNull()
    expect((await f.registry.materializeReadOnly()).providers.get('one')?.headers).toMatchObject({ 'X-Account': 'canonical-adapter-private' })
  })
  it('resumes canonical v2 header protection from a secret-free journal after vault failure without republishing plaintext', async () => {
    const f = await populated(), path = join(f.dataDir, 'model-connections.v2.json')
    const document = JSON.parse(await readFile(path, 'utf8'))
    document.profiles.one.headers = { 'X-Adapter': 'interrupted-canonical-secret' }
    const previous = JSON.stringify(document)
    await writeFile(path, previous)
    vi.spyOn(f.credentials, 'set').mockRejectedValueOnce(new Error('vault unavailable'))
    await expect(f.registry.initialize()).rejects.toThrow('vault unavailable')
    expect(await readFile(path, 'utf8')).toBe(previous)
    const journalText = await readFile(join(f.dataDir, 'provider-header-migration.v1.json'), 'utf8')
    expect(journalText).not.toContain('interrupted-canonical-secret')
    const stagedRef = Object.values(JSON.parse(journalText).headers)[0]
    await f.registry.initialize()
    const recovered = JSON.parse(await readFile(path, 'utf8'))
    expect(recovered.profiles.one.headersRef).toBe(stagedRef)
    expect(await readFile(path, 'utf8')).not.toContain('interrupted-canonical-secret')
  })
  it('gates downgrade on current v2-only semantics and preserves current identities for an expressible projection', () => {
    const document = emptyDocument()
    document.profiles.one = { id: 'one', accountId: 'new-account', name: 'New', kind: 'http', authType: 'api-key',
      endpointFormat: 'chat_completions', useProxy: false, models: ['new-model'], configured: true, credentialRef: 'cred_current' }
    document.revision = 5
    expect(exportProviderRegistryDowngrade(document, 5)).toMatchObject({ schemaVersion: 1, profiles: { one: { accountId: 'new-account', credentialRef: 'cred_current' } } })
    document.profiles.one.modelCapabilities = { 'new-model': { id: 'new-model', inputModalities: ['text'], outputModalities: ['text'], supportsToolCalling: true, messageParts: ['text'], evidence: { supportsToolCalling: { source: 'adapter', status: 'unknown' } } } }
    expect(previewProviderRegistryDowngrade(document).blockingReasons[0].reason).toContain('Capability evidence')
    document.profiles.one.modelCapabilities = undefined
    document.configuration.connections.one = { enabled: false, inherit: [], manualModels: [] }
    expect(previewProviderRegistryDowngrade(document)).toMatchObject({ canDowngrade: false })
    expect(() => exportProviderRegistryDowngrade(document, 5)).toThrow('cannot express')
    expect(() => exportProviderRegistryDowngrade(document, 4)).toThrow('changed')
  })
  it('fails closed on Manager loss without a local write fallback', async () => {
    const f = await fixture(), path = join(f.dataDir, 'model-connections.v2.json'), before = await readFile(path, 'utf8')
    configureManagerAtomicJsonClient({ baseUrl: 'http://127.0.0.1:1', token: 'test', dataDir: f.dataDir })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Manager disconnected')))
    await expect(f.registry.previewConfiguration({ expectedRevision: 0, operations: [{ kind: 'put-group', group: { id: 'group', name: 'Group' } }] })).rejects.toThrow('Manager disconnected')
    expect(await readFile(path, 'utf8')).toBe(before)
  })
  it('rejects a future canonical Registry version without overwriting it from old recovery data', async () => {
    const f = await fixture(), path = join(f.dataDir, 'model-connections.v2.json')
    await writeFile(path, JSON.stringify({ schemaVersion: 3, revision: 9 }))
    await expect(f.registry.initialize()).rejects.toThrow('unsupported version')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ schemaVersion: 3, revision: 9 })
  })
})
