import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { ModelConnectionRegistry } from './model-connection-registry.js'
import { PROVIDER_REGISTRY_FILE } from './provider-registry-migration.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, readFile: vi.fn(fs.readFile) }
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
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-registry-health-batch-'))
  roots.push(dataDir)
  const credentials = new ExtensionCredentialStore({ dataDir, profileId: 'test' })
  const registry = new ModelConnectionRegistry({ dataDir, credentials })
  await registry.initialize()
  return { dataDir, credentials, registry }
}

it('inspects keys and protected headers in one read, preserving anonymous status and fresh failures', async () => {
  const { dataDir, credentials, registry } = await fixture()
  let snapshot = await registry.connect({ ...connection, id: 'key', expectedRevision: 0,
    credential: 'fake-key', customHeaders: { 'X-Test': 'fake-header' } })
  snapshot = await registry.connect({ ...connection, id: 'anonymous', expectedRevision: snapshot.revision,
    authType: 'none', customHeaders: { 'X-Test': 'fake-anonymous-header' } })
  const document = JSON.parse(await readFile(join(dataDir, PROVIDER_REGISTRY_FILE), 'utf8'))
  const path = join(dataDir, 'credentials', 'credentials.enc.json')
  vi.mocked(readFile).mockClear()
  const first = await registry.configurationSnapshot()
  expect(first.connections.find((profile) => profile.id === 'key')?.credentialStatus).toBe('ready')
  expect(first.connections.find((profile) => profile.id === 'anonymous')?.credentialStatus).toBe('not-required')
  expect(vi.mocked(readFile).mock.calls.filter(([file]) => file === path)).toHaveLength(1)
  expect(JSON.stringify(first)).not.toContain('fake-')
  await credentials.set(document.profiles.key.customHeadersRef, { apiKey: JSON.stringify({ Host: 'forbidden' }) })
  await credentials.delete(document.profiles.anonymous.customHeadersRef)
  const invalid = await registry.configurationSnapshot()
  expect(invalid.connections.every((profile) => profile.credentialStatus === 'unreadable')).toBe(true)
  await credentials.set(document.profiles.key.customHeadersRef, { apiKey: JSON.stringify({ 'X-Test': 'fresh' }) })
  await credentials.delete(document.profiles.key.credentialRef)
  expect((await registry.configurationSnapshot()).connections.find((profile) => profile.id === 'key'))
    .toMatchObject({ configured: false, credentialStatus: 'missing' })
})

it('keeps an in-flight credential fence missing without inspecting the fenced key', async () => {
  const { registry, credentials } = await fixture()
  const connected = await registry.connect({ ...connection, id: 'key', expectedRevision: 0, credential: 'fake-key' })
  await registry.fenceCredential('key', { expectedRevision: connected.revision, operationToken: `credential:${randomUUID()}:1` })
  const inspect = vi.spyOn(credentials, 'inspectHealth')
  const snapshot = await registry.configurationSnapshot()
  expect(snapshot.connections[0]).toMatchObject({ configured: false, credentialStatus: 'missing' })
  expect(inspect).toHaveBeenCalledWith([], expect.any(Function))
})

it('bounds legacy source checks while preserving independent unreadable and missing states', async () => {
  const { dataDir, credentials } = await fixture()
  let active = 0
  let peak = 0
  const inspectCredentialSource = async (source: string) => {
    active++
    peak = Math.max(peak, active)
    try {
      await new Promise((resolve) => setTimeout(resolve, 1))
      if (source === 'legacy:0') throw new Error('private failure')
      return source === 'legacy:1' ? 'missing' as const : 'ready' as const
    } finally { active-- }
  }
  const registry = new ModelConnectionRegistry({ dataDir, credentials, inspectCredentialSource })
  await registry.initialize(Array.from({ length: 25 }, (_, index) => ({ ...connection,
    id: `legacy-${index}`, expectedRevision: 0, credentialSourceId: `legacy:${index}` })))
  peak = 0
  const snapshot = await registry.configurationSnapshot()
  expect(peak).toBeGreaterThan(1)
  expect(peak).toBeLessThanOrEqual(8)
  expect(snapshot.connections.find((profile) => profile.id === 'legacy-0')?.credentialStatus).toBe('unreadable')
  expect(snapshot.connections.find((profile) => profile.id === 'legacy-1')?.credentialStatus).toBe('missing')
  expect(JSON.stringify(snapshot)).not.toContain('private failure')
})
