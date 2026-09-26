import { describe, expect, it } from 'vitest'
import { Jimp } from 'jimp'
import { roomImageDimensions, roomPreviewImage } from './room-preview-image.js'

describe('normalized room thumbnail and avatar pixels', () => {
  it('produces a bounded 128px square JPEG avatar and reuses the content cache', async () => {
    const input = await new Jimp({ width: 64, height: 96, color: 0x3377ffff }).getBuffer('image/png')
    const first = await roomPreviewImage(input, 128, true)
    expect(first).toMatchObject({ mimeType: 'image/jpeg', width: 128, height: 128 })
    expect(roomImageDimensions(Buffer.from(first.dataBase64, 'base64'))).toEqual({ width: 128, height: 128 })
    expect(await roomPreviewImage(input, 128, true)).toBe(first)
  })
  it('rejects SVG/script input and oversized dimensions before decoding', async () => {
    await expect(roomPreviewImage(Buffer.from('<svg onload="alert(1)"></svg>'))).rejects.toThrow()
    const bytes = Buffer.alloc(24)
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
    bytes.writeUInt32BE(100000, 16); bytes.writeUInt32BE(100000, 20)
    await expect(roomPreviewImage(bytes)).rejects.toThrow('unsupported_or_oversized_image')
  })
})
