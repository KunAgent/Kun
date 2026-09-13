import type { CSSProperties } from 'react'
import { UserRound } from 'lucide-react'
import type { RoomMember } from '@shared/rooms-api'
import avatarAtlas from '../../../../asset/img/room-avatars/kun-avatar-atlas.png'
import { avatarForIdentity, ROOM_AVATARS, ROOM_AVATAR_BACKGROUND_SIZE } from './room-avatar-catalog'
import './rooms-avatars.css'
import { useRoomUploadedAvatar } from './room-uploaded-avatar'

const tones = [
  'var(--ds-accent)',
  'var(--ds-success)',
  'var(--ds-skill)',
  'var(--ds-text-muted)',
  'var(--ds-danger)'
]

function identityTone(id: string): string {
  let hash = 0
  for (const char of id)
    hash = (Math.imul(hash, 31) + char.codePointAt(0)!) >>> 0
  return tones[hash % tones.length]
}

export function RoomAvatarPortrait({ index }: { index: number }) {
  const portrait = ROOM_AVATARS[index] ?? ROOM_AVATARS[0]
  return (
    <span
      className="rooms-avatar-art"
      aria-hidden="true"
      data-avatar-id={portrait.id}
      style={{
        backgroundImage: `url("${avatarAtlas}")`,
        backgroundSize: ROOM_AVATAR_BACKGROUND_SIZE,
        backgroundPosition: portrait.backgroundPosition
      }}
    />
  )
}

export function RoomAvatar({
  member,
  id,
  label,
  size = 38,
  onClick
}: {
  member?: RoomMember
  id?: string
  label: string
  size?: number
  onClick?: () => void
}) {
  const identity = id ?? member?.id ?? 'kun'
  const uploaded = useRoomUploadedAvatar(member?.avatar?.kind === 'uploaded' ? member.avatar.attachmentId : undefined)
  const builtinId = member?.avatar?.kind === 'builtin' ? member.avatar.id : undefined
  const selected = ROOM_AVATARS.find((item) => item.id === builtinId)
  const style = {
    '--rooms-avatar-size': `${size / 16}rem`,
    '--rooms-avatar-tone': identityTone(identity)
  } as CSSProperties
  const content = (
    <>
      {identity === 'user' ? (
        <UserRound aria-hidden="true" className="rooms-avatar-user" />
      ) : uploaded ? (
        <img className="rooms-avatar-art object-cover" src={uploaded} alt="" aria-hidden="true" />
      ) : (
        <RoomAvatarPortrait index={selected?.index ?? avatarForIdentity(identity).index} />
      )}
      <span className="rooms-avatar-letter" aria-hidden="true">
        {Array.from(label.trim())[0]?.toLocaleUpperCase() ?? 'K'}
      </span>
    </>
  )
  return onClick ? (
    <button
      type="button"
      className="rooms-avatar rooms-avatar-button"
      style={style}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <span
      className="rooms-avatar"
      style={style}
      title={label}
      role="img"
      aria-label={label}
    >
      {content}
    </span>
  )
}

export function RoomAvatarGroup({
  members,
  size = 44,
  onClick
}: {
  members: RoomMember[]
  size?: number
  onClick?: () => void
}) {
  const visible = members.filter((member) => !member.removedAt).slice(0, 4)
  const label = visible.map((member) => member.displayName).join(', ') || 'Kun'
  const className = `rooms-avatar-group rooms-avatar-group-${Math.max(1, visible.length)}`
  const style = { '--rooms-avatar-size': `${size / 16}rem` } as CSSProperties
  const content = visible.length ? (
    visible.map((member) => (
      <RoomAvatar
        key={member.id}
        member={member}
        label={member.displayName}
        size={size}
      />
    ))
  ) : (
    <RoomAvatar label="Kun" size={size} />
  )
  return onClick ? (
    <button
      type="button"
      className={`${className} rooms-avatar-button`}
      style={style}
      aria-label={label}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <span className={className} style={style} role="img" aria-label={label}>
      {content}
    </span>
  )
}
