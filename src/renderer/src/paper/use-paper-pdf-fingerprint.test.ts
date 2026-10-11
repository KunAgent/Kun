import { createHash, webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { paperPdfFingerprint } from './use-paper-pdf-fingerprint'

afterEach(() => vi.unstubAllGlobals())
describe('paper viewer byte identity', () => {
  it('hashes loaded bytes, not PDF metadata or a mutable path', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const original = Buffer.from('%PDF-1.7\noriginal\n')
    expect(await paperPdfFingerprint(original.toString('base64'))).toBe(createHash('sha256').update(original).digest('hex'))
    expect(await paperPdfFingerprint(original.toString('base64'))).not.toBe(await paperPdfFingerprint(Buffer.from('%PDF-1.7\nreplaced\n').toString('base64')))
  })
})
