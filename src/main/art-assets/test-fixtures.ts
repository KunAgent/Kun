import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readArtCatalog } from '../../../kun/src/contracts/kun-art-catalog'
import type { ArtManifest } from '../../shared/kun-art'
import { hash } from './verification'
const keys = generateKeyPairSync('ed25519')
export const publicKey = String(keys.publicKey.export({ type: 'spki', format: 'pem' }))
export async function fixture() {
  const root = resolve('src/asset/img/kun-avatar')
  const index = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
  const files: ArtManifest['files'] = {}, assets: ArtManifest['assets'] = {}, objects = new Map<string, Buffer>()
  for (const name of index.assetManifests) {
    const rows = JSON.parse(await readFile(resolve(root, name), 'utf8'))
    for (const [key, row] of Object.entries(rows) as [string, { webp: Record<string, string> }][]) {
      assets[key] = { webp: row.webp }
      for (const [tier, path] of Object.entries(row.webp)) {
        const bytes = await readFile(resolve(root, path)), sha256 = hash(bytes)
        files[path] = { sha256, size: bytes.length, width: Number(tier), height: Number(tier) }; objects.set(sha256, bytes)
      }
    }
  }
  const manifest: ArtManifest = { schemaVersion: 1, rendererVersion: 1, releaseId: 'test-v1', minAppVersion: '0.3.10',
    catalogVersion: '1c67a9f9e946781d', catalog: readArtCatalog(), canvas: 1024,
    anchors: { faceBox: index.anchors.faceBox, compactFaceBox: index.anchors.compactFaceBox }, assets, files }
  return { manifest, objects }
}
export function envelope(manifest: ArtManifest) {
  const payload = Buffer.from(JSON.stringify(manifest))
  return Buffer.from(JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, keys.privateKey).toString('base64') }))
}
export function descriptor(manifest: ArtManifest) {
  const bytes = envelope(manifest)
  return { releaseId: manifest.releaseId, sha256: hash(bytes), size: bytes.length }
}
