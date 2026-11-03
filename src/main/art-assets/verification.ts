import { createHash, verify } from 'node:crypto'
import { parseArtManifest } from '../../../kun/src/contracts/kun-art-schema'
import type { ArtFile, ArtManifest } from '../../shared/kun-art'
import { ART_PUBLIC_KEY } from './public-key'
export const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
export function verifyEnvelope(bytes: Uint8Array, publicKey = ART_PUBLIC_KEY): ArtManifest {
  if (bytes.length > 2 * 1024 * 1024) throw new Error('manifest_too_large')
  const envelope = JSON.parse(Buffer.from(bytes).toString('utf8')) as { payload: unknown; signature: unknown }
  if (typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' || envelope.signature.length !== 88) throw new Error('invalid_signature')
  const payload = Buffer.from(envelope.payload, 'base64')
  if (!verify(null, payload, publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('invalid_signature')
  return parseArtManifest(JSON.parse(payload.toString('utf8')))
}
export function verifyFile(bytes: Uint8Array, file: ArtFile): void {
  const b = Buffer.from(bytes)
  if (b.length !== file.size || hash(b) !== file.sha256) throw new Error('file_hash_mismatch')
  if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP' || b.readUInt32LE(4) + 8 !== b.length) throw new Error('invalid_webp')
  let width = 0, height = 0
  const format = b.toString('ascii', 12, 16)
  if (format === 'VP8X') {
    if (b[20] & 2) throw new Error('animated_webp_not_supported')
    width = b.readUIntLE(24, 3) + 1; height = b.readUIntLE(27, 3) + 1
  } else if (format === 'VP8 ' && b[23] === 0x9d && b[24] === 1 && b[25] === 0x2a) {
    width = b.readUInt16LE(26) & 0x3fff; height = b.readUInt16LE(28) & 0x3fff
  } else if (format === 'VP8L' && b[20] === 0x2f) {
    width = 1 + (((b[22] & 0x3f) << 8) | b[21]); height = 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | (b[22] >> 6))
  }
  if (width !== file.width || height !== file.height) throw new Error('invalid_dimensions')
}
export function compatible(manifest: Pick<ArtManifest, 'minAppVersion'>, appVersion: string): boolean {
  const parse = (s: string) => { const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-[a-zA-Z0-9.-]+)?$/.exec(s); return m ? m.slice(1, 4).map(Number) : null }
  const min = parse(manifest.minAppVersion), app = parse(appVersion)
  if (!min || !app) return false
  for (let i = 0; i < 3; i++) { if (app[i] > min[i]) return true; if (app[i] < min[i]) return false }
  return true
}
