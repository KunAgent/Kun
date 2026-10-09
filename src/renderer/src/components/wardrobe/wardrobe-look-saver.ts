import type { RoomUserProfileDetail } from '@shared/rooms-api'
import { acceptRoomUserProfile, useRoomUserProfile } from '../rooms/room-user-profile'
import { roomRequestId, roomsRequest } from '../rooms/rooms-client'
import type { WardrobeAvatar } from './wardrobe-page-model'

const PROFILE = '/v1/rooms/user-profile'

/**
 * Applies a look as soon as it is chosen. Saves run one at a time and a newer choice replaces any
 * queued one, so a burst of clicks ends on the last look. A stale revision reloads the profile and
 * retries once; `onIdle` fires when nothing is left to save.
 */
export function createWardrobeLookSaver({ onIdle, onError }: { onIdle: () => void; onError: (message: string) => void }) {
  let running = false
  let queued: { avatar: WardrobeAvatar } | null = null
  const load = async () => {
    const detail = await roomsRequest<RoomUserProfileDetail>(PROFILE)
    acceptRoomUserProfile(detail)
    return detail
  }
  const put = async (avatar: WardrobeAvatar) => {
    const revision = useRoomUserProfile.getState().revision ?? (await load()).revision
    acceptRoomUserProfile(await roomsRequest<RoomUserProfileDetail>(PROFILE, 'PUT', {
      avatar, expectedRevision: revision, clientRequestId: roomRequestId() }))
  }
  const drain = async () => {
    running = true
    let failed = ''
    while (queued) {
      const { avatar } = queued
      queued = null
      try { await put(avatar); failed = '' } catch {
        try { await load(); await put(avatar); failed = '' } catch (cause) { failed = String(cause) }
      }
    }
    running = false
    if (failed) onError(failed)
    else onIdle()
  }
  return {
    save(avatar: WardrobeAvatar) {
      queued = { avatar }
      if (!running) void drain()
    }
  }
}
