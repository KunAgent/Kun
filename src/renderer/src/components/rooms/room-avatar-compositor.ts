import {
  canonicalKunAvatarKey,
  kunAvatarBodyClip,
  kunAvatarFraming,
  kunAvatarLayerKeys,
  kunAvatarScene,
  normalizeKunAvatarParts,
  type KunAvatarFraming,
  type KunAvatarParts,
  type KunAvatarRenderOptions
} from '@shared/rooms-api'
import rawManifest from '../../../../asset/img/kun-avatar/manifest.json'
import { AvatarCompositionCache, type AvatarCompositionResource } from './room-avatar-composition-cache'
import { renderAvatarComposition } from './room-avatar-composition-canvas'
import { activeArtManifest } from './art-asset-store'
import { loadAvatarManifest, type AvatarManifest } from './room-avatar-manifest'

export interface AvatarRenderRequest {
  key: string
  manifest: AvatarManifest
  releaseId?: string
  layers: string[]
  bodyClip: ReturnType<typeof kunAvatarBodyClip>
  background: string
  parts: KunAvatarParts
  pixels: number
  framing: KunAvatarFraming
  size: number
  effects: boolean
}

const assetPrefix = '../../../../asset/img/kun-avatar/'
const manifestGroups = import.meta.glob('../../../../asset/img/kun-avatar/manifests/*.json', {
  eager: true, import: 'default'
}) as Record<string, unknown>
const bundledManifest = loadAvatarManifest(rawManifest, Object.fromEntries(
  Object.entries(manifestGroups).map(([path, value]) => [path.slice(assetPrefix.length), value])
))
const assetUrls = import.meta.glob('../../../../asset/img/kun-avatar/**/*.webp', {
  eager: true,
  // Even tiny layers stay external: opening the app must not inline every outfit.
  query: '?url&no-inline',
  import: 'default'
}) as Record<string, string>

export const composedAvatarCache = new AvatarCompositionCache()

export function avatarRenderRequest(parts: KunAvatarParts, size: number, dpr: number, effects = false,
  framing: KunAvatarFraming = kunAvatarFraming(size)): AvatarRenderRequest {
  const remote = activeArtManifest()
  const manifest: AvatarManifest = remote ? { ...remote, version: remote.releaseId } : bundledManifest
  const normalized = normalizeKunAvatarParts(parts)
  const pixels = Math.max(1, Math.min(2048, Math.ceil(size * Math.max(1, dpr || 1))))
  const showEffects = effects && size >= 96
  return {
    manifest, releaseId: remote?.releaseId,
    layers: kunAvatarLayerKeys(normalized, { size, effects: showEffects, framing }),
    bodyClip: kunAvatarBodyClip(normalized),
    background: kunAvatarScene(normalized.bg) ? 'transparent' : normalized.bg,
    key: `${manifest.version}:${canonicalKunAvatarKey(normalized)}:${pixels}:${size}:${framing}:${showEffects ? 'effects' : 'plain'}`,
    parts: normalized,
    pixels,
    framing,
    size,
    effects: showEffects
  }
}

export function composedAvatarLayers(parts: KunAvatarParts, options: KunAvatarRenderOptions = {}): string[] {
  return kunAvatarLayerKeys(parts, options)
}

export function composedAvatarSourceTier(request: AvatarRenderRequest): 128 | 256 | 512 {
  const manifest = request.manifest
  const crop = manifest.anchors.compactFaceBox ?? manifest.anchors.faceBox
  const cropWidth = crop[2] - crop[0]
  const required = request.pixels * (request.framing === 'face' ? manifest.canvas / cropWidth : 1)
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
export function composedAvatarLayerUrl(key: string, tier: 96 | 128 | 256 | 512): string | undefined {
  const remote = activeArtManifest()
  const path = (remote ?? bundledManifest).assets[key]?.webp[String(tier)]
  return path ? remote ? `kun-asset://${remote.releaseId}/${path}` : assetUrls[`${assetPrefix}${path}`] : undefined
}

export async function composeAvatar(request: AvatarRenderRequest): Promise<AvatarCompositionResource> {
  const tier = composedAvatarSourceTier(request)
  const manifest = request.manifest
  const keys = request.layers
  const urls = keys.map((key) => {
    const path = manifest.assets[key]?.webp[String(tier)]
    const url = path && (request.releaseId ? `kun-asset://${request.releaseId}/${path}` : assetUrls[`${assetPrefix}${path}`])
    if (!url) throw new Error(`Missing avatar layer: ${key} (${tier})`)
    return url
  })
  const bodyClip = request.bodyClip
  return renderAvatarComposition(urls, {
    pixels: request.pixels,
    canvas: manifest.canvas,
    crop: request.framing === 'face' ? manifest.anchors.compactFaceBox ?? manifest.anchors.faceBox : undefined,
    layerClips: bodyClip ? { [keys.indexOf(`base/${request.parts.color}`)]: bodyClip } : undefined,
    bg: request.background
  })
}

export function acquireComposedAvatar(request: AvatarRenderRequest) {
  return composedAvatarCache.acquire(request.key, (isNeeded) => composeQueued(request, isNeeded))
}
