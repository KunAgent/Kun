import { mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { readModelCatalog, writeModelCatalog } from './model-catalog-store.js'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { PROVIDER_REGISTRY_FILE } from './provider-registry-migration.js'

vi.mock('./model-catalog-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./model-catalog-store.js')>()
  return { ...actual, readModelCatalog: vi.fn(actual.readModelCatalog) }
})

const roots: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const connection = { name: 'Test', kind: 'http' as const, authType: 'api-key' as const,
  baseUrl: 'https://provider.example/v1', endpointFormat: 'chat_completions' as const,
  models: ['model'], probe: false, select: false }

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-registry-snapshot-cache-'))
  roots.push(dataDir)
  const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'test' })
  const registry = new ModelConnectionRegistry({ dataDir, credentials })
  await registry.initialize()
  let snapshot = await registry.connect({ ...connection, id: 'first', expectedRevision: 0, credential: 'fake-key' })
  snapshot = await registry.connect({ ...connection, id: 'second', expectedRevision: snapshot.revision, credential: 'fake-key' })
  return { dataDir, registry, revision: snapshot.revision }
}

const catalogReads = () => vi.mocked(readModelCatalog).mock.calls.length

it('projects an unchanged Registry once and hands every caller its own copy', async () => {
  const { registry } = await fixture()
  vi.mocked(readModelCatalog).mockClear()
  const first = await registry.snapshot()
  const projected = catalogReads()
  first.providers.length = 0
  const [second, third] = await Promise.all([registry.snapshot(), registry.snapshot()])
  expect(catalogReads()).toBe(projected)
  expect(second.providers.map((profile) => profile.id).sort()).toEqual(['first', 'second'])
  expect(third).toEqual(second)
})

it('projects again after a Registry write, a catalog write, or an explicit invalidation', async () => {
  const { dataDir, registry, revision } = await fixture()
  await registry.snapshot()
  vi.mocked(readModelCatalog).mockClear()
  await registry.connect({ ...connection, id: 'third', expectedRevision: revision, credential: 'fake-key' })
  await registry.snapshot()
  expect(catalogReads()).toBeGreaterThan(0)

  vi.mocked(readModelCatalog).mockClear()
  await writeModelCatalog(dataDir, 'first', { fetchedAt: new Date().toISOString(), models: ['model'] })
  await registry.snapshot()
  expect(catalogReads()).toBeGreaterThan(0)

  vi.mocked(readModelCatalog).mockClear()
  await registry.snapshot()
  expect(catalogReads()).toBe(0)
  registry.invalidateSnapshotCache()
  await registry.snapshot()
  expect(catalogReads()).toBeGreaterThan(0)
})

it('waits out an unchanged long poll without projecting the Registry', async () => {
  const { registry, revision } = await fixture()
  const current = await registry.snapshot()
  vi.mocked(readModelCatalog).mockClear()
  const waited = await registry.waitForRevision(revision, new AbortController().signal, 20, current.metadataRevision)
  expect(waited.revision).toBe(revision)
  expect(catalogReads()).toBe(0)
})

it('runs the legacy Registry migration once, and again only after the canonical file disappears', async () => {
  const { dataDir, registry } = await fixture()
  const migrate = vi.spyOn(registry as unknown as { migrateLegacyRegistry: () => Promise<void> }, 'migrateLegacyRegistry')
  const read = (registry as unknown as { readDocumentForCredentialConsumer: (id: string) => Promise<{ profiles: Record<string, unknown> }> })
    .readDocumentForCredentialConsumer.bind(registry)
  await read('first')
  await read('second')
  await read('first')
  expect(migrate).toHaveBeenCalledTimes(1)
  await unlink(join(dataDir, PROVIDER_REGISTRY_FILE))
  await read('first')
  expect(migrate).toHaveBeenCalledTimes(2)
})
