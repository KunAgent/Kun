import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { normalizeKunAvatarParts, type KunComposedAvatarReference } from '@shared/rooms-api'
import { acquireComposedAvatar, avatarRenderRequest } from './room-avatar-compositor'

function devicePixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}

const ratioListeners = new Set<() => void>()
let stopWatchingRatio: (() => void) | undefined
function subscribePixelRatio(notify: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  ratioListeners.add(notify)
  if (!stopWatchingRatio) {
    let media: MediaQueryList | undefined
    const watch = () => {
      media?.removeEventListener?.('change', changed)
      media = window.matchMedia?.(`(resolution: ${devicePixelRatio()}dppx)`)
      // Older engines and test doubles expose a MediaQueryList without listeners.
      media?.addEventListener?.('change', changed)
    }
    const changed = () => { watch(); ratioListeners.forEach((listener) => listener()) }
    watch()
    window.addEventListener?.('resize', changed)
    stopWatchingRatio = () => {
      media?.removeEventListener?.('change', changed)
      window.removeEventListener?.('resize', changed)
    }
  }
  return () => {
    ratioListeners.delete(notify)
    if (!ratioListeners.size) { stopWatchingRatio?.(); stopWatchingRatio = undefined }
  }
}

export function useRoomComposedAvatar(reference: KunComposedAvatarReference | undefined, size: number) {
  const dpr = useSyncExternalStore(subscribePixelRatio, devicePixelRatio, () => 1)
  const serialized = reference ? JSON.stringify(normalizeKunAvatarParts(reference.parts)) : ''
  const request = useMemo(() => serialized ? avatarRenderRequest(JSON.parse(serialized), size, dpr) : undefined,
    [serialized, size, dpr])
  const [loaded, setLoaded] = useState<{ key: string; url: string }>()
  useEffect(() => {
    if (!request) return
    let active = true
    const lease = acquireComposedAvatar(request)
    void lease.promise.then((url) => {
      if (active) setLoaded({ key: request.key, url })
    }, () => {
      // RoomAvatar retains its identity portrait when a layer is unavailable.
    })
    return () => { active = false; lease.release() }
  }, [request])
  return request && loaded?.key === request.key ? loaded.url : undefined
}
