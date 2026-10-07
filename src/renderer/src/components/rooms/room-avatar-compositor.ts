import {
  canonicalKunAvatarKey,
  kunAvatarLayerKeys,
  normalizeKunAvatarParts,
  type KunAvatarParts
} from '@shared/rooms-api'
import rawManifest from '../../../../asset/img/kun-avatar/manifest.json'
import { AvatarCompositionCache, type AvatarCompositionResource } from './room-avatar-composition-cache'
import { renderAvatarComposition } from './room-avatar-composition-canvas'

interface AvatarManifest {
  version: string
  canvas: number
  anchors: { faceBox: number[] }
  assets: Record<string, { webp: Record<string, string> }>
}

export interface AvatarRenderRequest {
  key: string
  parts: KunAvatarParts
  pixels: number
  compact: boolean
}

const manifest: AvatarManifest = rawManifest
const assetPrefix = '../../../../asset/img/kun-avatar/'
const assetUrls = import.meta.glob('../../../../asset/img/kun-avatar/**/*.webp', {
  eager: true,
  // Even tiny layers stay external: opening the app must not inline every outfit.
  query: '?url&no-inline',
  import: 'default'
}) as Record<string, string>

export const composedAvatarCache = new AvatarCompositionCache()

export function avatarRenderRequest(parts: KunAvatarParts, size: number, dpr: number): AvatarRenderRequest {
  const normalized = normalizeKunAvatarParts(parts)
  const pixels = Math.max(1, Math.min(2048, Math.ceil(size * Math.max(1, dpr || 1))))
  const compact = size <= 48
  return {
    key: `${manifest.version}:${canonicalKunAvatarKey(normalized)}:${pixels}:${compact ? 'face' : 'full'}`,
    parts: normalized,
    pixels,
    compact
  }
}

export function composedAvatarLayers(parts: KunAvatarParts): string[] {
  return kunAvatarLayerKeys(parts)
}

export function composedAvatarSourceTier(request: AvatarRenderRequest): 128 | 256 | 512 {
  const cropWidth = manifest.anchors.faceBox[2] - manifest.anchors.faceBox[0]
  const required = request.pixels * (request.compact ? manifest.canvas / cropWidth : 1)
  return required <= 128 ? 128 : required <= 256 ? 256 : 512
}

// Limit simultaneous decodes during preset galleries and rapid editor changes.
let activeCompositions = 0
const waiting: Array<() => void> = []
async function composeQueued(request: AvatarRenderRequest, isNeeded: () => boolean): Promise<AvatarCompositionResource> {
  if (!isNeeded()) throw new Error('Avatar composition no longer needed')
  if (activeCompositions >= 4) await new Promise<void>((resolve) => waiting.push(resolve))
  else activeCompositions += 1
  try {
    if (!isNeeded()) throw new Error('Avatar composition no longer needed')
    return await composeAvatar(request)
  } finally {
    const next = waiting.shift()
    if (next) next()
    else activeCompositions -= 1
  }
}

/** One bundled layer by manifest key; the wardrobe shows accessories on their own. */
export function composedAvatarLayerUrl(key: string, tier: 128 | 256 | 512): string | undefined {
  const path = manifest.assets[key]?.webp[String(tier)]
  return path ? assetUrls[`${assetPrefix}${path}`] : undefined
}

export async function composeAvatar(request: AvatarRenderRequest): Promise<AvatarCompositionResource> {
  const tier = composedAvatarSourceTier(request)
  const urls = composedAvatarLayers(request.parts).map((key) => {
    const path = manifest.assets[key]?.webp[String(tier)]
    const url = path && assetUrls[`${assetPrefix}${path}`]
    if (!url) throw new Error(`Missing avatar layer: ${key} (${tier})`)
    return url
  })
  return renderAvatarComposition(urls, {
    pixels: request.pixels,
    canvas: manifest.canvas,
    crop: request.compact ? manifest.anchors.faceBox : undefined,
    bg: request.parts.bg
  })
}

export function acquireComposedAvatar(request: AvatarRenderRequest) {
  return composedAvatarCache.acquire(request.key, (isNeeded) => composeQueued(request, isNeeded))
}
