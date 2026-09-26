import type { AttachmentTextFallback } from '../contracts/attachments.js'
import type { RoomPreviewImage } from '../contracts/room-content.js'
import { roomPreviewImage } from './room-preview-image.js'
import { detectImage } from '../attachments/attachment-store.js'

const MAX_DISPLAY_BYTES = 512 * 1024
const MAX_DISPLAY_DIMENSION = 1280
/** The desktop upload pipeline emits a static WebP fallback by default. */
export function uploadedWebpDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 20 || bytes.length > MAX_DISPLAY_BYTES || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('invalid display preview')
  let canvas: { width: number; height: number } | undefined
  let frame: { width: number; height: number } | undefined
  let count = 0, offset = 12
  while (offset + 8 <= bytes.length && ++count <= 64) {
    const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4)
    const start = offset + 8, end = start + length
    if (end > bytes.length) throw new Error('invalid display preview')
    if (kind === 'ANIM' || kind === 'ANMF') throw new Error('animated display preview unavailable')
    if (kind === 'VP8X') {
      if (length !== 10 || bytes[start] & 2) throw new Error('invalid display preview')
      canvas = { width: bytes.readUIntLE(start + 4, 3) + 1, height: bytes.readUIntLE(start + 7, 3) + 1 }
    } else if (kind === 'VP8 ') {
      if (frame || length < 10 || !bytes.subarray(start + 3, start + 6).equals(Buffer.from([157, 1, 42]))) throw new Error('invalid display preview')
      frame = { width: bytes.readUInt16LE(start + 6) & 0x3fff, height: bytes.readUInt16LE(start + 8) & 0x3fff }
    } else if (kind === 'VP8L') {
      if (frame || length < 5 || bytes[start] !== 47) throw new Error('invalid display preview')
      const bits = bytes.readUInt32LE(start + 1)
      if (bits >>> 29) throw new Error('invalid display preview')
      frame = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    offset = end + length % 2
  }
  if (offset !== bytes.length || !frame || !frame.width || !frame.height ||
    Math.max(frame.width, frame.height) > MAX_DISPLAY_DIMENSION ||
    canvas && (canvas.width !== frame.width || canvas.height !== frame.height)) throw new Error('invalid display preview')
  return frame
}

/** Uses only the already-persisted upload projection, never the original attachment. */
export async function roomUploadedPreviewImage(preview: AttachmentTextFallback): Promise<RoomPreviewImage> {
  if (preview.dataBase64.length > 2 * 1024 * 1024) throw new Error('display preview too large')
  const bytes = Buffer.from(preview.dataBase64, 'base64')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(preview.mimeType) || detectImage(bytes)?.mimeType !== preview.mimeType) {
    throw new Error('invalid display preview')
  }
  if (preview.mimeType !== 'image/webp') return roomPreviewImage(bytes)
  const dimensions = uploadedWebpDimensions(bytes)
  return { ...dimensions, mimeType: 'image/webp', dataBase64: bytes.toString('base64') }
}
