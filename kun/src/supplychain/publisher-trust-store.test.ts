import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { InMemoryPublisherTrustStore, loadPublisherTrustStore } from './publisher-trust-store.js'

describe('publisher trust store', () => {
  it('exposes runtime-owned publisher keys without caller input', () => {
    const store = new InMemoryPublisherTrustStore({ kun: 'pem-1', empty: '' })
    expect(store.getPublisherKey('kun')).toBe('pem-1')
    expect(store.getPublisherKey('missing')).toBeUndefined()
    expect(store.trustedPublisherIds()).toEqual(['kun'])
  })

  it('loads a JSON key map and fails closed on missing files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-trust-'))
    const file = join(dir, 'publishers.json')
    await writeFile(file, JSON.stringify({ kun: 'pem-1', ignored: 42 }), 'utf8')

    const loaded = await loadPublisherTrustStore(file)
    expect(loaded.getPublisherKey('kun')).toBe('pem-1')
    expect(loaded.trustedPublisherIds()).toEqual(['kun'])

    const missing = await loadPublisherTrustStore(join(dir, 'missing.json'))
    expect(missing.trustedPublisherIds()).toEqual([])
  })
})
