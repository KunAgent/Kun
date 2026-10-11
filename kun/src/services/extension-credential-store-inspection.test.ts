import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createAesEncryptor } from '../security/secret-store.js'
import { ExtensionCredentialStore, type ExtensionCredentialPayload } from './extension-credential-store.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, readFile: vi.fn(fs.readFile) }
})

const roots: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-credential-inspection-'))
  roots.push(dataDir)
  const store = new ExtensionCredentialStore({ dataDir, profileId: 'test' })
  return { dataDir, store, path: join(dataDir, 'credentials', 'credentials.enc.json') }
}
const project = (payload: ExtensionCredentialPayload | null) => Boolean(payload?.apiKey?.trim())
const ready = { readable: true, health: true }
const missing = { readable: true, health: false }
const unreadable = { readable: false }
const readsOf = (path: string) => vi.mocked(readFile).mock.calls.filter(([file]) => file === path).length

it('reads once for each of 20 fresh inspections of 500 encrypted credentials', async () => {
  const { store, path } = await fixture()
  const refs = Array.from({ length: 500 }, (_, index) => `cred_batch-${index}`)
  for (const reference of refs) await store.set(reference, { apiKey: `fake-${reference}` })
  vi.mocked(readFile).mockClear()
  for (let index = 0; index < 20; index++) {
    const result = await store.inspectHealth(refs, project)
    expect(result.size).toBe(500)
    expect([...result.values()].every((health) => health.readable && health.health)).toBe(true)
  }
  expect(readsOf(path)).toBe(20)
}, 30_000)

it('projects duplicate references once and observes external rotation and revocation on the next request', async () => {
  const { dataDir, store, path } = await fixture()
  const other = new ExtensionCredentialStore({ dataDir, profileId: 'test' })
  await store.set('cred_rotated', { apiKey: 'fake-first' })
  const inspect = vi.fn(project)
  expect((await store.inspectHealth(['cred_rotated', 'cred_rotated'], inspect)).get('cred_rotated')).toEqual(ready)
  expect(inspect).toHaveBeenCalledTimes(1)
  await other.set('cred_rotated', { apiKey: '   ' })
  expect((await store.inspectHealth(['cred_rotated'], project)).get('cred_rotated')).toEqual(missing)
  await other.set('cred_rotated', { apiKey: 'fake-second' })
  expect((await store.inspectHealth(['cred_rotated'], project)).get('cred_rotated')).toEqual(ready)
  await other.delete('cred_rotated')
  expect((await store.inspectHealth(['cred_rotated'], project)).get('cred_rotated')).toEqual(missing)
  vi.mocked(readFile).mockClear()
  expect((await store.inspectHealth([], project)).size).toBe(0)
  expect(readsOf(path)).toBe(0)
})

it('isolates invalid references and malformed entries while failing closed on a malformed document', async () => {
  const { store, path } = await fixture()
  await store.set('cred_good', { apiKey: 'fake-good' })
  await store.set('cred_bad', { apiKey: 'fake-bad' })
  await store.set('cred_token', { accessToken: 'fake-token' })
  const document = JSON.parse(await readFile(path, 'utf8'))
  document.credentials.cred_bad.tag = 'corrupt'
  await writeFile(path, JSON.stringify(document))
  const refs = ['cred_good', 'cred_bad', 'cred_missing', 'cred_token', 'invalid']
  expect(await store.inspectHealth(refs, project)).toEqual(new Map([
    ['cred_good', ready], ['cred_bad', unreadable], ['cred_missing', missing],
    ['cred_token', missing], ['invalid', unreadable]
  ]))
  await writeFile(path, '{malformed')
  expect([...((await store.inspectHealth(refs, project)).values())]).toEqual(refs.map(() => unreadable))
})

it('uses the platform key provider without caching plaintext and rejects profile or reference substitution', async () => {
  const { dataDir, path } = await fixture()
  const encryptor = createAesEncryptor(randomBytes(32))
  const decrypt = vi.spyOn(encryptor, 'decrypt')
  const keyProvider = { encryptor, osKeychain: true, reason: 'test platform key' }
  const store = new ExtensionCredentialStore({ dataDir, profileId: 'test', keyProvider })
  await store.set('cred_original', { apiKey: 'fake-platform' })
  await store.inspectHealth(['cred_original', 'cred_absent'], project)
  await store.inspectHealth(['cred_original'], project)
  expect(decrypt).toHaveBeenCalledTimes(2)
  const document = JSON.parse(await readFile(path, 'utf8'))
  document.credentials.cred_copied = document.credentials.cred_original
  await writeFile(path, JSON.stringify(document))
  expect((await store.inspectHealth(['cred_copied'], project)).get('cred_copied')).toEqual(unreadable)
  const other = new ExtensionCredentialStore({ dataDir, profileId: 'other', keyProvider })
  expect((await other.inspectHealth(['cred_original'], project)).get('cred_original')).toEqual(unreadable)
})

it('bounds authoritative primary reads and isolates failures without touching the encrypted fallback', async () => {
  const { dataDir, store: fallback, path } = await fixture()
  await fallback.set('cred_0', { apiKey: 'must-not-be-used' })
  const refs = Array.from({ length: 25 }, (_, index) => `cred_${index}`)
  let active = 0
  let peak = 0
  let revoked = false
  const get = vi.fn(async (reference: string) => {
    active++
    peak = Math.max(peak, active)
    try {
      await new Promise((resolve) => setTimeout(resolve, 1))
      if (reference === 'kun:test:cred_0') throw new Error('test unavailable')
      if (reference === 'kun:test:cred_1') return '{malformed'
      if (reference === 'kun:test:cred_2') return JSON.stringify({ apiKey: 123 })
      if (reference === 'kun:test:cred_3' || revoked) return null
      return JSON.stringify({ apiKey: 'fake-primary' })
    } finally { active-- }
  })
  const store = new ExtensionCredentialStore({ dataDir, profileId: 'test', primary: {
    id: 'test-primary', isAvailable: async () => true, get,
    set: async () => undefined, delete: async () => undefined
  } })
  vi.mocked(readFile).mockClear()
  const result = await store.inspectHealth(refs, project)
  expect(peak).toBeGreaterThan(1)
  expect(peak).toBeLessThanOrEqual(8)
  expect(get).toHaveBeenCalledTimes(25)
  expect([...result.values()].filter((health) => !health.readable)).toHaveLength(3)
  expect(result.get('cred_3')).toEqual(missing)
  expect(result.get('cred_4')).toEqual(ready)
  revoked = true
  expect((await store.inspectHealth(['cred_4'], project)).get('cred_4')).toEqual(missing)
  expect(readsOf(path)).toBe(0)
})

it('does not fall back when the configured primary is unavailable even if an encrypted store exists', async () => {
  const { dataDir, store: fallback, path } = await fixture()
  await fallback.set('cred_existing', { apiKey: 'must-not-be-used' })
  const get = vi.fn(async () => null)
  const store = new ExtensionCredentialStore({ dataDir, profileId: 'test', primary: {
    id: 'test-primary', isAvailable: async () => false, get,
    set: async () => undefined, delete: async () => undefined
  } })
  vi.mocked(readFile).mockClear()
  expect((await store.inspectHealth(['cred_existing'], project)).get('cred_existing')).toEqual(unreadable)
  expect(get).not.toHaveBeenCalled()
  expect(readsOf(path)).toBe(0)
})
