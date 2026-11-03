import { useEffect } from 'react'
import { create } from 'zustand'
import { hasKunAccountSession, type KunAccountState } from '@shared/kun-account'
import type { RoomAvatarReference, RoomUserProfileDetail } from '@shared/rooms-api'
import { roomsRequest } from './rooms-client'
import { subscribeRoomEvents } from './room-event-listeners'
import { syncAccountLook, canChangeKunAppearance, WardrobeAccountError } from './room-wardrobe'
import { reconcileUserAvatarOwner, rememberedUserAvatar, rememberUserAvatar } from './room-user-avatar-cache'

// The first frame wears the look the last run ended with; the runtime's answer replaces it.
export const useRoomUserProfile = create<RoomUserProfileDetail>(() => ({ profile: { avatar: rememberedUserAvatar() }, revision: null }))
/** True while the store still holds the remembered look and the runtime has not answered yet. */
let fromMemory = useRoomUserProfile.getState().profile.avatar !== null
export function acceptRoomUserProfile(detail: RoomUserProfileDetail) {
  if ((useRoomUserProfile.getState().revision ?? -1) > (detail.revision ?? -1)) return
  // Remember before publishing: faces rendered for this look are saved against the record.
  rememberUserAvatar(detail.profile.avatar)
  fromMemory = false
  useRoomUserProfile.setState(detail)
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

const RETRY_FIRST_MS = 2000
const RETRY_MAX_MS = 30000

function startRoomUserProfileSync(): () => void {
  const controller = new AbortController()
  let serial = 0
  let retryDelay = RETRY_FIRST_MS
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  // Keep the remembered look until the first answer; only the revision resets so that answer always wins.
  useRoomUserProfile.setState({ revision: null })
  const refresh = async () => {
    const version = ++serial
    clearTimeout(retryTimer)
    try {
      const detail = await roomsRequest<RoomUserProfileDetail>('/v1/rooms/user-profile', 'GET', undefined, controller.signal)
      if (controller.signal.aborted || version !== serial) return
      acceptRoomUserProfile(detail)
      retryDelay = RETRY_FIRST_MS
    } catch {
      // The runtime may still be starting: keep the remembered look and ask again soon, then every 30s.
      if (controller.signal.aborted || version !== serial) return
      retryTimer = setTimeout(() => void refresh(), retryDelay)
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
    }
  }
  // A signed-out or different account must not inherit the remembered look, and a new account's look must be fetched.
  let owner: string | null | undefined
  const accountChanged = (state: KunAccountState) => {
    const next = hasKunAccountSession(state) && state.user ? state.user.id : state.status === 'anonymous' ? null : undefined
    if (next === undefined || next === owner) return
    const first = owner === undefined
    owner = next
    if (reconcileUserAvatarOwner(next) && fromMemory) useRoomUserProfile.setState({ profile: { avatar: null }, revision: null })
    if (first) return
    // Revisions belong to one account's look, so the new account's answer must win whatever the old one reached.
    useRoomUserProfile.setState({ revision: null })
    void refresh()
  }
  const account = typeof window === 'undefined' ? undefined : window.kunGui?.kunAccount
  const offAccount = account?.onState?.(accountChanged)
  void account?.getState?.().then(accountChanged).catch(() => undefined)
  void refresh()
  const off = subscribeRoomEvents((event) => { if (event.kind === 'presentation.user-profile.updated') void refresh() })
  const timer = setInterval(() => void refresh(), 30000)
  return () => { controller.abort(); clearTimeout(retryTimer); off(); offAccount?.(); clearInterval(timer) }
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
