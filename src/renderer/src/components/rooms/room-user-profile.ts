import { useEffect } from 'react'
import { create } from 'zustand'
import type { RoomAvatarReference, RoomUserProfileDetail } from '@shared/rooms-api'
import { roomsRequest } from './rooms-client'
import { subscribeRoomEvents } from './room-event-listeners'
import { syncAccountLook, canChangeKunAppearance, WardrobeAccountError } from './room-wardrobe'

export const useRoomUserProfile = create<RoomUserProfileDetail>(() => ({ profile: { avatar: null }, revision: null }))
export function acceptRoomUserProfile(detail: RoomUserProfileDetail) {
  useRoomUserProfile.setState((previous) => (previous.revision ?? -1) <= (detail.revision ?? -1) ? detail : previous)
}

/**
 * Saves the user's own avatar. Signed in, a composed look also becomes the Kun account avatar, so
 * the website and every device show it too; a photo stays on this machine.
 */
export async function saveRoomUserProfile(input: {
  avatar: RoomAvatarReference | null; expectedRevision: number | null; clientRequestId: string
}): Promise<RoomUserProfileDetail> {
  if (!canChangeKunAppearance()) throw new WardrobeAccountError('anonymous')
  const detail = await roomsRequest<RoomUserProfileDetail>('/v1/rooms/user-profile', 'PUT', input)
  acceptRoomUserProfile(detail)
  if (input.avatar?.kind === 'composed') syncAccountLook(input.avatar.parts)
  return detail
}

function startRoomUserProfileSync(): () => void {
  const controller = new AbortController()
  let serial = 0
  useRoomUserProfile.setState({ profile: { avatar: null }, revision: null })
  const refresh = async () => {
    const version = ++serial
    try {
      const detail = await roomsRequest<RoomUserProfileDetail>('/v1/rooms/user-profile', 'GET', undefined, controller.signal)
      if (!controller.signal.aborted && version === serial) acceptRoomUserProfile(detail)
    } catch { /* Offline avatars fall back to the bundled mascot. */ }
  }
  void refresh()
  const off = subscribeRoomEvents((event) => { if (event.kind === 'presentation.user-profile.updated') void refresh() })
  const timer = setInterval(() => void refresh(), 30000)
  return () => { controller.abort(); off(); clearInterval(timer) }
}

let syncUsers = 0
let stopSync: (() => void) | null = null
/** Keeps the user's own avatar fresh; every mounted user shares one fetch, event listener and poll. */
export function useRoomUserProfileSync() {
  useEffect(() => {
    if (syncUsers++ === 0) stopSync = startRoomUserProfileSync()
    return () => {
      if (--syncUsers > 0) return
      stopSync?.()
      stopSync = null
    }
  }, [])
}
