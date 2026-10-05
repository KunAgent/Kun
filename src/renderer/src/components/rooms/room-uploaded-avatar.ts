import { useEffect, useState } from 'react'
import type { RoomPreviewImage } from '@shared/rooms-api'
import { roomsRequest } from './rooms-client'

const avatars = new Map<string, string>()
const pending = new Map<string, Promise<string | undefined>>()
export function cacheRoomAvatar(id: string, image: RoomPreviewImage): void {
  if (avatars.size >= 100) avatars.delete(avatars.keys().next().value!)
  avatars.set(id, `data:${image.mimeType};base64,${image.dataBase64}`)
}
export function useRoomUploadedAvatar(id?: string): string | undefined {
  const [loaded, setLoaded] = useState<{ id: string; url: string | undefined }>()
  useEffect(() => {
    if (!id) { setLoaded(undefined); return }
    const cached = avatars.get(id)
    if (cached) { setLoaded({ id, url: cached }); return }
    setLoaded(undefined)
    let active = true
    let promise = pending.get(id)
    if (!promise) {
      promise = roomsRequest<{ image?: RoomPreviewImage }>(`/v1/rooms/avatars/${encodeURIComponent(id)}`).then((value) => {
        if (value.image) cacheRoomAvatar(id, value.image)
        return avatars.get(id)
      }).catch(() => undefined).finally(() => pending.delete(id))
      pending.set(id, promise)
    }
    void promise.then((value) => { if (active) setLoaded({ id, url: value }) })
    return () => { active = false }
  }, [id])
  return id && loaded?.id === id ? loaded.url : id ? avatars.get(id) : undefined
}
