import type { ReactElement } from 'react'
import { composedAvatarLayerUrl } from './room-avatar-compositor'

export type WardrobeBottleState = 'sealed' | 'glowing' | 'open'

/** The painted bottle from the avatar art set; the surrounding rarity token tints its halo. */
export function WardrobeBottleIcon({ size = 28, state = 'glowing' }: { size?: number; state?: WardrobeBottleState }): ReactElement {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const url = composedAvatarLayerUrl(`container/bottle-${state}`, size * dpr <= 96 ? 96 : size * dpr <= 256 ? 256 : 512)
  return <span className="rooms-wardrobe-bottle-icon" style={{ width: size, height: size }} aria-hidden="true">
    {url ? <img src={url} alt="" draggable={false} decoding="async" /> : null}
  </span>
}

/** The shared back of every role card that has not been revealed yet. */
export function WardrobeCardBack({ width, height }: { width: number; height: number }): ReactElement {
  const url = composedAvatarLayerUrl('card/back', width * (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1) <= 128 ? 128 : 256)
  return <span className="rooms-wardrobe-card-back" style={{ width, height }} aria-hidden="true">
    {url ? <img src={url} alt="" draggable={false} decoding="async" /> : null}
  </span>
}
