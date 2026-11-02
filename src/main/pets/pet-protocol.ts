import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { PET_ASSET_HOST, PET_ASSET_SCHEME } from '../../shared/pets'

const PET_ID = /^[a-z0-9:_-]{1,160}$/

export type PetAssetLookup = (petId: string) => string | null

export function parsePetAssetUrl(url: string): { petId: string; version: string | null } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${PET_ASSET_SCHEME}:` || parsed.hostname !== PET_ASSET_HOST) return null
  if (parsed.username || parsed.password || parsed.port) return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length !== 2 || segments[1] !== 'spritesheet') return null
  let petId = ''
  try {
    petId = decodeURIComponent(segments[0] ?? '')
    if (petId.includes('%')) petId = decodeURIComponent(petId)
  } catch {
    return null
  }
  if (!PET_ID.test(petId) || petId.includes('..') || petId.includes('/') || petId.includes('\\')) return null
  return { petId, version: parsed.searchParams.get('v') }
}

export async function readPetAsset(url: string, lookup: PetAssetLookup, libraryRoot: string): Promise<Response> {
  if (url.startsWith('file:') || url.includes('..') || url.includes('\\')) {
    return denied()
  }
  const parsed = parsePetAssetUrl(url)
  if (!parsed) return denied()
  const assetPath = lookup(parsed.petId)
  if (!assetPath) return denied()
  const library = await realpath(libraryRoot)
  const asset = await realpath(assetPath)
  const relative = path.relative(library, asset)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return denied()
  const extension = path.extname(asset).toLowerCase()
  if (extension !== '.png' && extension !== '.webp') return denied()
  const bytes = await readFile(asset)
  return new Response(bytes, {
    headers: {
      'Content-Type': extension === '.png' ? 'image/png' : 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: parsed.version ? `"${parsed.version}"` : '"unversioned"',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    }
  })
}

export function petSenderAllowed(input: {
  senderId: number
  allowedSenderIds: ReadonlySet<number>
  isMainFrame: boolean
}): boolean {
  return input.isMainFrame && input.allowedSenderIds.has(input.senderId)
}

function denied(): Response {
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
