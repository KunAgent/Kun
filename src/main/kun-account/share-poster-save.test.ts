import { describe, expect, it } from 'vitest'
import { MAX_SHARE_POSTER_BYTES, validateSharePosterSave } from './share-poster-save'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')
const valid = { dataBase64: png.toString('base64'), fileName: 'Kun-邀请-K7QM4XPA.png' }
describe('poster save IPC validation', () => {
  it('accepts PNG bytes and a safe filename', () => {
    expect(validateSharePosterSave(valid)).toEqual({ bytes: png, fileName: valid.fileName })
  })
  it('rejects non-PNG bytes, malformed base64 and extra path fields', () => {
    for (const input of [null, [], { ...valid, dataBase64: Buffer.from('not PNG').toString('base64') }, { ...valid, dataBase64: '!!!!' }, { ...valid, path: '/tmp/elsewhere.png' }]) expect(() => validateSharePosterSave(input)).toThrow()
  })
  it('accepts a payload at the maximum size without regex stack overflow', () => {
    const bytes = Buffer.alloc(MAX_SHARE_POSTER_BYTES); png.copy(bytes)
    expect(validateSharePosterSave({ ...valid, dataBase64: bytes.toString('base64') }).bytes.length).toBe(MAX_SHARE_POSTER_BYTES)
  })
  it('rejects oversized input before decoding', () => {
    expect(() => validateSharePosterSave({ ...valid, dataBase64: 'A'.repeat(Math.ceil(MAX_SHARE_POSTER_BYTES / 3) * 4 + 4) })).toThrow()
  })
  it('rejects traversal, extensions, separators and long filenames', () => {
    for (const fileName of ['../x.png', '/tmp/x.png', 'x\\y.png', 'x.jpg', 'a.png.exe', 'a b.png', 'a'.repeat(97) + '.png']) expect(() => validateSharePosterSave({ ...valid, fileName })).toThrow()
  })
})
