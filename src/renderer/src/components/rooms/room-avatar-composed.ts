import { useArtRevision } from './art-asset-store'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { kunAvatarFraming, normalizeKunAvatarParts, type KunAvatarFraming, type KunComposedAvatarReference } from '@shared/rooms-api'
import { acquireComposedAvatar, avatarRenderRequest } from './room-avatar-compositor'
import { faceDataUrl, rememberedFace, rememberFace } from './room-user-avatar-cache'

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

/**
 * `persist` is for the user's own look: the finished face is saved on this machine and shown on the
 * next launch before the layers have been decoded again. The saved face is re-checked against a fresh
 * render, so changed artwork replaces it.
 */
export function useRoomComposedAvatar(reference: KunComposedAvatarReference | undefined, size: number, effects = false,
  framing: KunAvatarFraming = kunAvatarFraming(size), persist = false) {
  const revision = useArtRevision()
  const dpr = useSyncExternalStore(subscribePixelRatio, devicePixelRatio, () => 1)
  const serialized = reference ? JSON.stringify(normalizeKunAvatarParts(reference.parts)) : ''
  const request = useMemo(() => serialized ? avatarRenderRequest(JSON.parse(serialized), size, dpr, effects, framing) : undefined,
    [serialized, size, dpr, effects, framing, revision])
  const [loaded, setLoaded] = useState<{ key: string; url: string }>()
  // The effect below follows the render request; the look being remembered is read when the picture is ready.
  const remembering = useRef<KunComposedAvatarReference | undefined>(undefined)
  remembering.current = persist ? reference : undefined
  useEffect(() => {
    if (!request) return
    let active = true
    const lease = acquireComposedAvatar(request)
    void lease.promise.then(async (url) => {
      if (remembering.current) {
        const face = await faceDataUrl(url, request.pixels)
        const owner = remembering.current
        // The saved copy is already what was drawn: leave it on screen instead of swapping in an identical image.
        if (face && owner && face === rememberedFace(owner, request.key)) return
        if (face && owner) rememberFace(owner, request.key, face)
      }
      if (active) setLoaded({ key: request.key, url })
    }, () => {
      // RoomAvatar retains its identity portrait when a layer is unavailable.
    })
    return () => { active = false; lease.release() }
  }, [request])
  if (request && loaded?.key === request.key) return loaded.url
  return persist && reference && request ? rememberedFace(reference, request.key) : undefined
}
