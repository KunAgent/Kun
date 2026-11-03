import type { ReactElement } from 'react'
import { KUN_AVATAR_CATALOG, type KunAvatarAccessoryCategory } from '@shared/rooms-api'
import { composedAvatarLayerUrl } from './room-avatar-compositor'

/** The inventory uses complete item illustrations, independently of the worn layer crop. */
export function avatarItemLayers(category: KunAvatarAccessoryCategory, id: string): string[] {
  return KUN_AVATAR_CATALOG[category].some((entry) => entry.id === id) ? [`icon/${category}/${id}`] : []
}

export function RoomAvatarItemArt({ category, id, size }: {
  category: KunAvatarAccessoryCategory; id: string; size: number
}): ReactElement {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const tier = size * dpr <= 128 ? 128 : 256
  const key = avatarItemLayers(category, id)[0]
  const url = key ? composedAvatarLayerUrl(key, tier) : undefined
  return <span className="rooms-avatar-item-art" style={{ width: size, height: size }} aria-hidden="true">
    {url ? <img src={url} alt="" draggable={false} loading="lazy" decoding="async" /> : null}
  </span>
}
