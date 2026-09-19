import { createHash } from 'node:crypto'
import type { RoomPreviewImage } from '../contracts/room-content.js'

const cache = new Map<string, RoomPreviewImage>()
let active = 0
export function roomImageDimensions(data: Buffer): { width: number; height: number } {
  let width = 0, height = 0
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    width = data.readUInt32BE(16); height = data.readUInt32BE(20)
  } else if (data[0] === 255 && data[1] === 216) {
    let offset = 2
    while (offset + 8 < data.length) {
      if (data[offset] !== 255) break
      const marker = data[offset + 1]
      if (marker === 216 || marker === 217) { offset += 2; continue }
      const length = data.readUInt16BE(offset + 2)
      if (length < 2 || offset + 2 + length > data.length) break
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        height = data.readUInt16BE(offset + 5); width = data.readUInt16BE(offset + 7); break
      }
      offset += 2 + length
    }
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16 * 1024 * 1024) {
    throw new Error('unsupported_or_oversized_image')
  }
  return { width, height }
}

/** Decode only bounded PNG/JPEG bitmaps and re-encode inert display pixels. */
export async function roomPreviewImage(data: Buffer, size = 384, square = false): Promise<RoomPreviewImage> {
  if (data.length > 12 * 1024 * 1024) throw new Error('image_too_large')
  roomImageDimensions(data)
  const key = createHash('sha256').update(data).update(`${size}:${square}`).digest('hex')
  const existing = cache.get(key)
  if (existing) return existing
  if (active >= 2) throw new Error('preview_busy')
  active += 1
  try {
    const { Jimp } = await import('jimp')
    const image = await Jimp.read(data)
    if (square) image.cover({ w: size, h: size })
    else image.scaleToFit({ w: size, h: size })
    const bytes = await image.getBuffer('image/jpeg', { quality: 82 })
    if (bytes.length > 192 * 1024) throw new Error('preview_too_large')
    const result = { dataBase64: bytes.toString('base64'), mimeType: 'image/jpeg',
      width: image.bitmap.width, height: image.bitmap.height }
    if (cache.size >= 64) cache.delete(cache.keys().next().value!)
    cache.set(key, result)
    return result
  } finally { active -= 1 }
}
