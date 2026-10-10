import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ArtStorage } from './storage'
import { ArtAssetService } from './service'
import { fixture, envelope, descriptor, publicKey } from './test-fixtures'
import { verifyEnvelope, verifyFile } from './verification'
import { installArtCatalog } from '../../../kun/src/contracts/kun-art-catalog'
import { KunAvatarPartsSchema } from '../../../kun/src/contracts/kun-avatar-schema'
import { KUN_AVATAR_CATALOG } from '../../../kun/src/contracts/kun-avatar-catalog'
let data: Awaited<ReturnType<typeof fixture>>
const roots: string[] = []
beforeAll(async () => { data = await fixture() })
afterEach(async () => { installArtCatalog(null); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'kun-art-test-')); roots.push(root)
  let manifest = structuredClone(data.manifest), offline = false, corrupt = false, failActivate = false, calls = 0
  const storage = new ArtStorage(root, publicKey)
  const options = {
    storage, publicKey, appVersion: '0.3.10', changed: () => {},
    activate: async (next: typeof manifest | null) => { if (failActivate) throw new Error('runtime'); installArtCatalog(next?.catalog ?? null) },
    fetch: async (url: string) => {
      if (offline) throw new Error('offline')
      if (url.includes('/latest?')) return Response.json(descriptor(manifest))
      if (url.includes('/releases/')) return new Response(envelope(manifest))
      calls++
      const hash = new URL(url).pathname.split('/').pop()!.replace('.webp', '')
      return new Response(new Uint8Array(corrupt ? Buffer.from('bad') : data.objects.get(hash)!))
    }
  }
  return { root, storage, options, service: new ArtAssetService(options), calls: () => calls,
    release: (next: typeof manifest) => { manifest = next }, offline: () => { offline = true }, corrupt: () => { corrupt = true }, failActivate: () => { failActivate = true } }
}
describe('signed art releases', () => {
  it('validates every shipped WebP and the signed manifest', () => {
    expect(verifyEnvelope(envelope(data.manifest), publicKey).releaseId).toBe('test-v1')
    for (const file of Object.values(data.manifest.files)) verifyFile(data.objects.get(file.sha256)!, file)
  })
  it('rejects changed signature, payload and wrong public key', () => {
    const value = JSON.parse(envelope(data.manifest).toString())
    value.payload = Buffer.from('{}').toString('base64')
    expect(() => verifyEnvelope(Buffer.from(JSON.stringify(value)), publicKey)).toThrow('invalid_signature')
    expect(() => verifyEnvelope(envelope(data.manifest))).toThrow('invalid_signature')
  })
  it('rejects missing layers, path traversal and unsupported renderer', () => {
    const m = structuredClone(data.manifest); delete m.assets['base/sky']
    expect(() => verifyEnvelope(envelope(m), publicKey)).toThrow('Missing layer')
    m.files['../escape.webp'] = Object.values(m.files)[0]
    expect(() => verifyEnvelope(envelope(m), publicKey)).toThrow()
    m.rendererVersion = 2 as 1
    expect(() => verifyEnvelope(envelope(m), publicKey)).toThrow()
  })
  it('downloads, switches atomically, restores offline and serves only declared files', async () => {
    const h = await harness(), state = await h.service.check()
    expect(state.phase).toBe('ready'); expect(state.manifest?.releaseId).toBe('test-v1'); expect(state.rollbackAvailable).toBe(true)
    const path = Object.keys(data.manifest.files)[0]
    expect((await h.service.resource(`kun-asset://test-v1/${path}`)).length).toBe(data.manifest.files[path].size)
    await expect(h.service.resource('kun-asset://test-v1/../../secret')).rejects.toThrow()
    await expect(h.service.resource(`kun-asset://test-v1/${path}?x=1`)).rejects.toThrow()
    h.offline()
    const restarted = new ArtAssetService(h.options)
    expect((await restarted.getState()).manifest?.releaseId).toBe('test-v1')
    expect((await restarted.check()).manifest?.releaseId).toBe('test-v1')
  })
  it('hot-loads a new catalog item and downloads zero unchanged files; rolls back', async () => {
    const h = await harness(); await h.service.check(); const count = h.calls()
    const m = structuredClone(data.manifest); m.releaseId = 'test-v2'
    const item = { ...m.catalog.parts.glasses[0], id: 'new-glasses' }; m.catalog.parts.glasses.push(item)
    m.assets['glasses/new-glasses'] = m.assets['glasses/square']; m.assets['glasses/new-glasses.small'] = m.assets['glasses/square.small']
    h.release(m)
    expect((await h.service.check()).manifest?.releaseId).toBe('test-v2')
    expect(h.calls()).toBe(count)
    expect(KUN_AVATAR_CATALOG.glasses.some(x => x.id === 'new-glasses')).toBe(true)
    expect(KunAvatarPartsSchema.safeParse({ color: 'sky', face: 'normal', glasses: 'new-glasses' }).success).toBe(true)
    expect((await h.service.rollback()).manifest?.releaseId).toBe('test-v1')
    expect((await h.service.check()).manifest?.releaseId).toBe('test-v1')
    expect((await new ArtAssetService(h.options).getState()).held).toBe(true)
    expect((await h.service.check(true)).manifest?.releaseId).toBe('test-v2')
  })
  it('keeps bundled art when a download is corrupt and never writes an active pointer', async () => {
    const h = await harness(); h.corrupt()
    expect((await h.service.check()).manifest).toBeNull()
    expect((await h.storage.pointer()).active).toBeNull()
  })
  it('keeps the active release when runtime activation fails', async () => {
    const h = await harness(); await h.service.check()
    const m = structuredClone(data.manifest); m.releaseId = 'test-v2'; h.release(m); h.failActivate()
    expect((await h.service.check()).manifest?.releaseId).toBe('test-v1')
    expect((await h.storage.pointer()).active).toBe('test-v1')
  })
  it('recovers a corrupt active manifest from the previous version at restart', async () => {
    const h = await harness(); await h.service.check()
    const m = structuredClone(data.manifest); m.releaseId = 'test-v2'; h.release(m); await h.service.check()
    await writeFile(join(h.root, 'manifests/test-v2.json'), '{}'); h.offline()
    const next = new ArtAssetService(h.options)
    expect((await next.getState()).manifest?.releaseId).toBe('test-v1')
    expect((await h.storage.pointer()).rejected).toContain('test-v2')
  })
  it('rejects corrupted cached files at startup and falls back to bundled art', async () => {
    const h = await harness(); await h.service.check()
    const file = Object.values(data.manifest.files)[0]
    await writeFile(h.storage.filePath(file.sha256), 'bad')
    expect((await new ArtAssetService(h.options).getState()).manifest).toBeNull()
  })
  it('deduplicates concurrent checks and rejects incompatible app versions', async () => {
    const h = await harness()
    await Promise.all([h.service.check(), h.service.check(), h.service.check()])
    expect(h.calls()).toBeLessThanOrEqual(Object.keys(data.manifest.files).length)
    expect(JSON.parse(await readFile(join(h.root, 'active.json'), 'utf8')).active).toBe('test-v1')
    const older = new ArtAssetService({ ...h.options, appVersion: '0.3.9' })
    expect((await older.getState()).manifest).toBeNull()
    expect((await older.check()).manifest).toBeNull()
  })
  it('restores the old catalog if committing the new active pointer fails', async () => {
    const h = await harness(); await h.service.check()
    const m = structuredClone(data.manifest); m.releaseId = 'test-v2'; m.catalog.parts.headwear[0].label.en = 'Changed'
    h.release(m)
    const save = h.storage.savePointer.bind(h.storage)
    vi.spyOn(h.storage, 'savePointer').mockImplementation(p => p.active === 'test-v2' ? Promise.reject(new Error('disk full')) : save(p))
    expect((await h.service.check()).manifest?.releaseId).toBe('test-v1')
    expect((await h.storage.pointer()).active).toBe('test-v1')
    expect(KUN_AVATAR_CATALOG.headwear[0].label.en).not.toBe('Changed')
  })
  it('falls back without deleting ownership when an active file becomes corrupt', async () => {
    const h = await harness(); await h.service.check()
    const path = Object.keys(data.manifest.files)[0], file = data.manifest.files[path]
    await writeFile(h.storage.filePath(file.sha256), 'bad')
    await expect(h.service.resource(`kun-asset://test-v1/${path}`)).rejects.toThrow()
    await h.service.rollback()
    expect((await h.service.getState()).manifest).toBeNull()
    expect((await h.storage.pointer()).held).toBe(true)
  })
  it('does not activate a release after shutdown cancels its downloads', async () => {
    const h = await harness(), original = h.options.fetch
    h.options.fetch = async url => {
      if (url.includes('/objects/')) h.service.dispose()
      return original(url)
    }
    expect((await h.service.check()).manifest).toBeNull()
    expect((await h.storage.pointer()).active).toBeNull()
  })

})
