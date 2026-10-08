import type { KunAvatarParts, KunWardrobeDrop, RoomUserProfileDetail } from '@shared/rooms-api'
import { editableKunAvatarParts } from './RoomAvatarComposer'
import { acceptRoomUserProfile } from './room-user-profile'
import { wearWardrobeDrop } from './room-wardrobe'
import { roomRequestId, roomsRequest } from './rooms-client'

/** Saves a new look as the user's own avatar, against the latest profile revision. */
export async function wearOnMe(change: (parts: KunAvatarParts) => KunAvatarParts): Promise<void> {
  const current = await roomsRequest<RoomUserProfileDetail>('/v1/rooms/user-profile')
  const parts = change(editableKunAvatarParts(current.profile.avatar, 'user', true))
  acceptRoomUserProfile(await roomsRequest<RoomUserProfileDetail>('/v1/rooms/user-profile', 'PUT', {
    avatar: { kind: 'composed', version: 1, parts }, expectedRevision: current.revision, clientRequestId: roomRequestId() }))
}
/** Puts a freshly opened item or role card on the user's own avatar. */
export const wearDropOnMe = (drop: KunWardrobeDrop): Promise<void> => wearOnMe((parts) => wearWardrobeDrop(parts, drop))
