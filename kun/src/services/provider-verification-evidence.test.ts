import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { recordProviderInferenceEvidence } from './provider-catalog-operations.js'
import { capabilityFieldKnown, metadataEvidence } from '../contracts/model-metadata-evidence.js'
import { modelCapabilitiesForModel } from '../loop/model-context-profile.js'
const dirs: string[] = []
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
async function fixture(full = false) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-provider-evidence-')); dirs.push(dataDir)
  const value = new ModelConnectionRegistry({ dataDir, credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' }), onChanged: async () => undefined })
  await value.initialize()
  await value.connect({ expectedRevision: 0, id: 'one', name: 'One', kind: 'http', authType: 'api-key',
    baseUrl: 'https://provider.test/v1', endpointFormat: full ? 'custom_endpoint' : 'chat_completions',
    models: ['model-a'], credential: 'test-key', probe: false, select: false })
  return value
}
describe('provider verification evidence', () => {
  it('does not turn manual configuration or a readable key into connectivity/catalog/inference proof', async () => {
    const value = await fixture(true), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await value.probe('one')
    expect((await value.catalog('one'))?.evidence).toMatchObject({ credential: { status: 'success' },
      connectivity: { status: 'unknown' }, catalog: { status: 'unknown' }, protocol: { status: 'unknown' }, inference: { status: 'unknown' } })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('distinguishes an empty successful catalog from successful inference and does not validate a replaced identity', async () => {
    const value = await fixture(); vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [] })))
    await value.probe('one')
    expect((await value.catalog('one'))?.evidence).toMatchObject({ catalog: { status: 'success' }, connectivity: { status: 'success' }, protocol: { status: 'unknown' }, inference: { status: 'unknown' } })
    const revision = (await value.snapshot()).revision
    await recordProviderInferenceEvidence(value, 'one', 'model-a', revision)
    expect((await value.catalog('one'))?.evidence?.inference).toMatchObject({ status: 'success', model: 'model-a' })
    await value.replaceCredential('one', { expectedRevision: revision, credential: 'replacement-key' })
    expect((await value.catalog('one'))?.evidence?.inference.status).toBe('unknown')
    await recordProviderInferenceEvidence(value, 'one', 'model-a', revision)
    expect((await value.catalog('one'))?.evidence?.inference.status).toBe('unknown')
  })
  it('retains credential-read evidence on a failed first catalog and records HTTP reachability separately', async () => {
    const value = await fixture(); vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    await expect(value.probe('one')).rejects.toThrow('HTTP 401')
    expect((await value.catalog('one'))?.evidence).toMatchObject({ credential: { status: 'success' },
      connectivity: { status: 'success' }, catalog: { status: 'failed' }, protocol: { status: 'unknown' }, inference: { status: 'unknown' } })
    expect((await value.catalog('one'))?.stale).toBe(true)
  })
  it('keeps fallback context and tools unknown while preserving explicit declarations and prices', () => {
    const fallback = modelCapabilitiesForModel('unknown-private-model')
    expect(capabilityFieldKnown(fallback, 'supportsToolCalling')).toBe(false)
    expect(capabilityFieldKnown(fallback, 'contextWindowTokens')).toBe(false)
    const declared = { supportsToolCalling: true, evidence: metadataEvidence({ supportsToolCalling: true }, 'user', new Date().toISOString()) }
    expect(capabilityFieldKnown(declared, 'supportsToolCalling')).toBe(true)
    expect(capabilityFieldKnown(declared, 'pricing')).toBe(false)
  })
})
