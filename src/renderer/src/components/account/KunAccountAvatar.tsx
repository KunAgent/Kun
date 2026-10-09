import type { ReactElement } from 'react'
import type { KunAccountUser } from '@shared/kun-account'
import { RoomAvatar } from '../rooms/RoomAvatar'
import { useRoomUserProfile } from '../rooms/room-user-profile'
import { kunAccountInitial } from './kun-account-view'

/**
 * The account wears the same Kun the wardrobe dresses: a composed look shows here as it does in
 * the sidebar and on the website. A photo or no look yet falls back to the name's initial.
 */
export function KunAccountAvatar({ user, size, large = false }: { user: KunAccountUser; size: number; large?: boolean }): ReactElement {
  const avatar = useRoomUserProfile((state) => state.profile.avatar)
  const composed = avatar?.kind === 'composed'
  return <span className={large ? 'kun-account-avatar is-large' : 'kun-account-avatar'} data-look={composed || undefined} aria-hidden="true">
    {composed ? <RoomAvatar user id="user" label="" size={size} /> : kunAccountInitial(user)}
  </span>
}
