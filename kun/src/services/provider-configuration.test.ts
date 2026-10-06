import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { emptyDocument } from './model-connection-registry-core.js'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { LEGACY_PROVIDER_REGISTRY_FILE, PROVIDER_REGISTRY_FILE } from './provider-registry-migration.js'

const folders: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})
async function registry(legacy?: unknown) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-provider-configuration-'))
  folders.push(dataDir)
  if (legacy) await writeFile(join(dataDir, LEGACY_PROVIDER_REGISTRY_FILE), JSON.stringify(legacy))
  const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'test' })
  const onChanged = vi.fn(async () => undefined)
  const value = new ModelConnectionRegistry({ dataDir, credentials, onChanged })
  await value.initialize()
  return { value, dataDir, onChanged }
}
const connection = { id: 'relay', name: 'Relay', kind: 'http' as const, authType: 'api-key' as const,
  baseUrl: 'https://relay.example/v1', endpointFormat: 'chat_completions' as const,
  models: ['coding'], probe: false, select: false }

describe('provider configuration transactions', () => {
  it('freezes template revisions, preserves explicit overrides, and keeps repeated preset accounts independent', async () => {
    const f = await registry()
    const firstAccount = await f.value.connect({ ...connection, presetSource: 'same-vendor', expectedRevision: 0, credential: 'first-key' })
    const accounts = await f.value.connect({ ...connection, id: 'relay-two', presetSource: 'same-vendor',
      expectedRevision: firstAccount.revision, credential: 'second-key' })
    const template = { id: 'vendor', name: 'Vendor', adapterId: 'http', revision: 1,
      defaults: { baseUrl: 'https://template.test/v1', admission: { maxConcurrent: 1, maxQueued: 0, queueWaitMs: 1000 } } }
    const preview = await f.value.previewConfiguration({ expectedRevision: accounts.revision, operations: [
      { kind: 'put-template', template },
      { kind: 'apply-template', templateId: 'vendor', revision: 1, connectionIds: ['relay'] },
      { kind: 'configure-connection', connectionId: 'relay-two', configuration: { enabled: false, manualModels: [], inherit: [] } }
    ] })
    const first = await f.value.commitConfiguration({ expectedRevision: accounts.revision, previewId: preview.previewId, idempotencyKey: 'template-v1' })
    expect(first.snapshot.connections.find((item) => item.id === 'relay')?.baseUrl).toBe(connection.baseUrl)
    expect(first.snapshot.connections.find((item) => item.id === 'relay-two')?.enabled).toBe(false)
    expect((await f.value.materializeReadOnly()).providers.get('relay')).toMatchObject({ apiKey: 'first-key', admission: { maxQueued: 0 } })
    const update = await f.value.previewConfiguration({ expectedRevision: first.committedRevision, operations: [
      { kind: 'put-template', template: { ...template, revision: 2, defaults: { baseUrl: 'https://new-template.test/v1' } } }
    ] })
    const changed = await f.value.commitConfiguration({ expectedRevision: first.committedRevision, previewId: update.previewId, idempotencyKey: 'update-template' })
    expect(changed.snapshot.configuration.connections.relay.template?.revision).toBe(1)
    const apply = await f.value.previewConfiguration({ expectedRevision: changed.committedRevision, operations: [
      { kind: 'apply-template', templateId: 'vendor', revision: 2, connectionIds: ['relay'], resetFields: ['baseUrl'] },
      { kind: 'clear-connection-fields', connectionId: 'relay', fields: ['selectedModel'] }
    ] })
    const applied = await f.value.commitConfiguration({ expectedRevision: changed.committedRevision, previewId: apply.previewId, idempotencyKey: 'apply-template' })
    expect(applied.snapshot.connections.find((item) => item.id === 'relay')).toMatchObject({ baseUrl: 'https://new-template.test/v1' })
    expect(applied.snapshot.connections.find((item) => item.id === 'relay-two')?.baseUrl).toBe(connection.baseUrl)
    expect(applied.snapshot.connections.find((item) => item.id === 'relay')?.selectedModel).toBeUndefined()
    expect(await f.value.credentialForCompatibility('relay-two')).toBe('second-key')
  })
  it('recovers interrupted legacy header protection before publishing a secret-free v2 Registry', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-legacy-header-')); folders.push(dataDir)
    const legacy = { ...emptyDocument(), schemaVersion: 1, profiles: { relay: {
      ...connection, probe: undefined, select: undefined, accountId: 'legacy-account', useProxy: false,
      configured: false, customHeaders: { 'X-Private': 'legacy-header-secret' }
    } } }
    await writeFile(join(dataDir, LEGACY_PROVIDER_REGISTRY_FILE), JSON.stringify(legacy))
    const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'test' })
    const set = vi.spyOn(credentials, 'set').mockRejectedValueOnce(new Error('simulated protected-store interruption'))
    const value = new ModelConnectionRegistry({ dataDir, credentials, onChanged: async () => undefined })
    await expect(value.initialize()).rejects.toThrow('interruption')
    await expect(readFile(join(dataDir, PROVIDER_REGISTRY_FILE), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(dataDir, 'provider-header-migration.v1.json'), 'utf8')).not.toContain('legacy-header-secret')
    await value.initialize()
    expect(set.mock.calls[0][0]).toBe(set.mock.calls[1][0])
    expect(await readFile(join(dataDir, PROVIDER_REGISTRY_FILE), 'utf8')).not.toContain('legacy-header-secret')
    expect(await value.getCustomHeaders('relay')).toEqual({ 'X-Private': 'legacy-header-secret' })
    await expect(readFile(join(dataDir, 'provider-header-migration.v1.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('encrypts request header values, preserves them across key rotation, and deletes unused references', async () => {
    const f = await registry()
    const first = await f.value.connect({ ...connection, expectedRevision: 0, credential: 'private-key',
      customHeaders: { 'X-Relay-Token': 'protected-header-secret' } })
    expect(JSON.stringify(first)).not.toContain('protected-header-secret')
    expect(await readFile(join(f.dataDir, PROVIDER_REGISTRY_FILE), 'utf8')).not.toContain('protected-header-secret')
    expect(await f.value.getCustomHeaders('relay')).toEqual({ 'X-Relay-Token': 'protected-header-secret' })
    const rotated = await f.value.replaceCredential('relay', { expectedRevision: first.revision, credential: 'rotated-key' })
    expect((await f.value.materializeReadOnly()).providers.get('relay')?.customHeaders).toEqual({ 'X-Relay-Token': 'protected-header-secret' })
    const cleared = await f.value.patch('relay', { expectedRevision: rotated.revision, customHeaders: {} })
    expect(await f.value.getCustomHeaders('relay')).toEqual({})
    expect(cleared.providers[0].customHeaderNames).toBeUndefined()
  })
  it('supports explicitly anonymous HTTP models without treating missing API keys as anonymous', async () => {
    const f = await registry()
    const snapshot = await f.value.connect({ ...connection, expectedRevision: 0, authType: 'none' })
    expect(snapshot.providers[0]).toMatchObject({ configured: true, credentialStatus: 'not-required' })
    expect((await f.value.materializeReadOnly()).providers.get('relay')?.apiKey).toBe('')
    const missing = await f.value.connect({ ...connection, id: 'requires-key', expectedRevision: snapshot.revision })
    expect(missing.providers.find((item) => item.id === 'requires-key')).toMatchObject({ configured: false, credentialStatus: 'missing' })
  })
  it('preserves legacy identities, defaults and tombstones while retaining a read-only recovery source', async () => {
    const { configuration: _configuration, ...base } = emptyDocument()
    const legacy = { ...base, schemaVersion: 1, revision: 12, profiles: {
      relay: { ...connection, probe: undefined, select: undefined, accountId: 'original-account',
        useProxy: false, configured: false }
    }, tombstones: { removed: { deletedRevision: 11 } } }
    const f = await registry(legacy)
    const snapshot = await f.value.configurationSnapshot()
    expect(snapshot).toMatchObject({ schemaVersion: 2, revision: 12,
      connections: [expect.objectContaining({ id: 'relay', accountId: 'original-account' })] })
    expect(JSON.parse(await readFile(join(f.dataDir, LEGACY_PROVIDER_REGISTRY_FILE), 'utf8'))).toEqual(JSON.parse(JSON.stringify(legacy)))
    expect(JSON.parse(await readFile(join(f.dataDir, PROVIDER_REGISTRY_FILE), 'utf8'))).toMatchObject({
      schemaVersion: 2, tombstones: { removed: { deletedRevision: 11 } }
    })
  })

  it('previews groups and inherited endpoints without applying them until an idempotent commit', async () => {
    const f = await registry()
    const first = await f.value.connect({ ...connection, expectedRevision: 0, credential: 'private-key' })
    const preview = await f.value.previewConfiguration({ expectedRevision: first.revision, operations: [
      { kind: 'put-group', group: { id: 'company', name: 'Company', defaults: { baseUrl: 'https://team.example/v1' } } },
      { kind: 'configure-connection', connectionId: 'relay', configuration: { groupId: 'company', inherit: ['baseUrl'] } }
    ] })
    expect((await f.value.snapshot()).providers[0].baseUrl).toBe(connection.baseUrl)
    expect(JSON.stringify(preview)).not.toContain('private-key')
    const request = { previewId: preview.previewId, expectedRevision: first.revision, idempotencyKey: 'save-company' }
    const result = await f.value.commitConfiguration(request)
    expect(result.applied).toBe(true)
    expect(result.snapshot.connections[0]).toMatchObject({ id: 'relay', baseUrl: 'https://team.example/v1' })
    expect((await f.value.commitConfiguration(request)).committedRevision).toBe(result.committedRevision)
    expect(result.snapshot.fieldSources.relay.baseUrl).toBe('group')
  })

  it('preserves legacy projection round-trips but applies actual endpoint edits and explicit v2 overrides', async () => {
    const f = await registry()
    const connected = await f.value.connect({ ...connection, expectedRevision: 0, credential: 'key' })
    const preview = await f.value.previewConfiguration({ expectedRevision: connected.revision, operations: [
      { kind: 'put-group', group: { id: 'team', name: 'Team', defaults: { baseUrl: 'https://group.test/v1' } } },
      { kind: 'configure-connection', connectionId: 'relay', configuration: { groupId: 'team', inherit: ['baseUrl'] } }
    ] })
    const grouped = await f.value.commitConfiguration({ expectedRevision: connected.revision, previewId: preview.previewId, idempotencyKey: 'legacy-group' })
    const roundTrip = await f.value.patch('relay', { expectedRevision: grouped.committedRevision, baseUrl: connection.baseUrl, name: 'Rename only' })
    expect(roundTrip.providers[0].baseUrl).toBe('https://group.test/v1')
    const edited = await f.value.patch('relay', { expectedRevision: roundTrip.revision, baseUrl: 'https://edited.test/v1' })
    expect(edited.providers[0].baseUrl).toBe('https://edited.test/v1')
    const inheritedAgain = await f.value.previewConfiguration({ expectedRevision: edited.revision, operations: [
      { kind: 'configure-connection', connectionId: 'relay', configuration: { groupId: 'team', inherit: ['baseUrl'] } },
      { kind: 'patch-connection', connectionId: 'relay', patch: { baseUrl: 'https://edited.test/v1' } }
    ] })
    const explicit = await f.value.commitConfiguration({ expectedRevision: edited.revision, previewId: inheritedAgain.previewId, idempotencyKey: 'explicit-v2' })
    expect(explicit.snapshot.connections[0].baseUrl).toBe('https://edited.test/v1')
    expect(explicit.snapshot.fieldSources.relay.baseUrl).toBe('connection')
  })

  it('rejects stale previews and group deletion with live references', async () => {
    const f = await registry()
    const snapshot = await f.value.connect({ ...connection, expectedRevision: 0 })
    const old = await f.value.previewConfiguration({ expectedRevision: snapshot.revision, operations: [
      { kind: 'put-group', group: { id: 'team', name: 'Team' } }
    ] })
    await f.value.patch('relay', { expectedRevision: snapshot.revision, name: 'Edited elsewhere' })
    await expect(f.value.commitConfiguration({ previewId: old.previewId,
      expectedRevision: snapshot.revision, idempotencyKey: 'stale' })).rejects.toThrow('revision changed')
    const current = await f.value.snapshot()
    const grouped = await f.value.previewConfiguration({ expectedRevision: current.revision, operations: [
      { kind: 'put-group', group: { id: 'team', name: 'Team' } },
      { kind: 'configure-connection', connectionId: 'relay', configuration: { groupId: 'team' } }
    ] })
    const saved = await f.value.commitConfiguration({ previewId: grouped.previewId,
      expectedRevision: current.revision, idempotencyKey: 'grouped' })
    await expect(f.value.previewConfiguration({ expectedRevision: saved.committedRevision,
      operations: [{ kind: 'remove-group', groupId: 'team' }] })).rejects.toThrow('references')
  })

  it('keeps disabled connections visible but removes them from executable clients', async () => {
    const f = await registry()
    const snapshot = await f.value.connect({ ...connection, expectedRevision: 0, credential: 'private-key' })
    const preview = await f.value.previewConfiguration({ expectedRevision: snapshot.revision, operations: [
      { kind: 'configure-connection', connectionId: 'relay', configuration: { enabled: false } }
    ] })
    await f.value.commitConfiguration({ previewId: preview.previewId, expectedRevision: snapshot.revision, idempotencyKey: 'disable' })
    expect((await f.value.snapshot()).providers[0]).toMatchObject({ id: 'relay', configured: true, enabled: false })
    expect((await f.value.materializeReadOnly()).providers.has('relay')).toBe(false)
  })

  it('records durable commit success separately from runtime activation failure', async () => {
    const f = await registry()
    const preview = await f.value.previewConfiguration({ expectedRevision: 0,
      operations: [{ kind: 'put-group', group: { id: 'team', name: 'Team' } }] })
    f.onChanged.mockRejectedValueOnce(new Error('runtime rejected this revision'))
    const result = await f.value.commitConfiguration({ previewId: preview.previewId, expectedRevision: 0, idempotencyKey: 'failure' })
    expect(result.applied).toBe(false)
    expect(result.snapshot.revision).toBeGreaterThan(result.snapshot.activeRevision)
  })

  it('rejects embedded secrets and expires uncommitted previews', async () => {
    const f = await registry()
    await expect(f.value.previewConfiguration({ expectedRevision: 0, operations: [{ kind: 'add-connection',
      connection: { ...connection, credential: 'must-not-enter-plain-config' } }] })).rejects.toThrow()
    const preview = await f.value.previewConfiguration({ expectedRevision: 0,
      operations: [{ kind: 'put-group', group: { id: 'team', name: 'Team' } }] })
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 11 * 60_000)
    await expect(f.value.commitConfiguration({ previewId: preview.previewId, expectedRevision: 0, idempotencyKey: 'expired' }))
      .rejects.toThrow('expired')
  })
})
