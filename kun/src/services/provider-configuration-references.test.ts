import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { scanProviderReferences } from './provider-configuration-references.js'
const folders: string[] = []
afterEach(async () => { await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function fixture(referenceSources?: () => Record<string, unknown>) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-provider-references-')); folders.push(dataDir)
  const registry = new ModelConnectionRegistry({ dataDir, credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' }), referenceSources })
  await registry.initialize()
  await registry.connect({ id: 'one', expectedRevision: 0, name: 'One', kind: 'http', authType: 'api-key', credential: 'private-key',
    baseUrl: 'https://one.test', models: ['coding'], probe: false, select: true })
  return registry
}
describe('provider reference transactions', () => {
  it('lists default, ADE, role and client scopes without leaking owner secrets', () => {
    const references = scanProviderReferences({ roles: { code: { providerId: 'one', apiKey: 'do-not-project' } },
      ade: { allowedConnectionIds: ['one'] }, smallModelProviderId: 'one' }, new Set(['one']))
    expect(references).toHaveLength(3)
    expect(JSON.stringify(references)).not.toContain('do-not-project')
  })
  it('requires default references to be explicitly cleared in the same atomic delete transaction', async () => {
    const registry = await fixture(), before = await registry.snapshot()
    await expect(registry.previewConfiguration({ expectedRevision: before.revision, operations: [{ kind: 'remove-connection', connectionId: 'one' }] })).rejects.toThrow('references')
    expect((await registry.snapshot()).providers).toHaveLength(1)
    const preview = await registry.previewConfiguration({ expectedRevision: before.revision, operations: [
      { kind: 'set-default-selection' }, { kind: 'set-failover', groups: [] }, { kind: 'remove-connection', connectionId: 'one' }] })
    expect(preview.references).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'default', connectionId: 'one' })]))
    const committed = await registry.commitConfiguration({ expectedRevision: before.revision, previewId: preview.previewId, idempotencyKey: 'delete' })
    expect(committed.snapshot.connections).toHaveLength(0)
    expect((await registry.snapshot()).defaultProviderId).toBeUndefined()
  })
  it('blocks external references at preview and rechecks new bindings before commit', async () => {
    let sources: Record<string, unknown> = { roles: { code: { providerId: 'one' } } }
    const registry = await fixture(() => sources), before = await registry.snapshot()
    const request = { expectedRevision: before.revision, operations: [{ kind: 'set-default-selection' }, { kind: 'remove-connection', connectionId: 'one' }] }
    await expect(registry.previewConfiguration(request)).rejects.toThrow('outside this transaction')
    sources = {}
    const preview = await registry.previewConfiguration(request)
    sources = { ade: { main: { allowedConnectionIds: ['one'] } } }
    await expect(registry.commitConfiguration({ expectedRevision: before.revision, previewId: preview.previewId, idempotencyKey: 'delete' })).rejects.toThrow('references changed')
    expect((await registry.snapshot()).providers).toHaveLength(1)
  })
  it('disables admission while preserving external bindings, default and account history identity', async () => {
    const registry = await fixture(() => ({ roles: { code: { providerId: 'one' } } })), before = await registry.snapshot()
    const preview = await registry.previewConfiguration({ expectedRevision: before.revision, operations: [
      { kind: 'configure-connection', connectionId: 'one', configuration: { enabled: false } }] })
    expect(preview.references?.some((reference) => reference.kind === 'roles')).toBe(true)
    const result = await registry.commitConfiguration({ expectedRevision: before.revision, previewId: preview.previewId, idempotencyKey: 'disable' })
    expect(result.snapshot.connections[0]).toMatchObject({ id: 'one', accountId: before.providers[0].accountId, enabled: false })
    expect((await registry.materializeReadOnly()).providers.size).toBe(0)
  })
})
