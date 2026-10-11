import { useWardrobe } from './room-wardrobe'
import { useState, type CSSProperties } from 'react'
import kunGreet from '../../../../asset/img/kun_greet.png'
import { useRoomUserProfile } from './room-user-profile'
import { kunAvatarFraming, type KunAvatarFraming, type RoomMember, type RoomAvatarReference } from '@shared/rooms-api'
import avatarAtlas from '../../../../asset/img/room-avatars/kun-avatar-atlas.png'
import { avatarForIdentity, ROOM_AVATARS, ROOM_AVATAR_BACKGROUND_SIZE } from './room-avatar-catalog'
import './rooms-avatars.css'
import { useRoomUploadedAvatar } from './room-uploaded-avatar'
import { useRoomComposedAvatar } from './room-avatar-composed'
import { AgentIcon } from '../agent-icon'

const tones = [
  'var(--ds-accent)',
  'var(--ds-success)',
  'var(--ds-skill)',
  'var(--ds-text-muted)',
  // Teal rather than the danger red: identity colour must not read as an error.
  '#1a9e9a'
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
  avatar,
  user = false,
  id,
  label,
  size = 38,
  framing,
  onClick
}: {
  member?: RoomMember
  avatar?: RoomAvatarReference | null
  user?: boolean
  id?: string
  label: string
  size?: number
  /** Defaults to the shared rule: the whole square picture, or the face below 28px. */
  framing?: KunAvatarFraming
  onClick?: () => void
}) {
  const identity = id ?? member?.id ?? 'kun'
  const profileAvatar = useRoomUserProfile((state) => state.profile.avatar)
  const isUser = user || identity === 'user'
  const wardrobeAccess = useWardrobe(false)
  const reference = isUser && wardrobeAccess.mode === 'guest' ? null : avatar !== undefined ? avatar : isUser ? profileAvatar : member?.avatar
  const uploaded = useRoomUploadedAvatar(reference?.kind === 'uploaded' ? reference.attachmentId : undefined)
  const view = framing ?? kunAvatarFraming(size)
  const composed = useRoomComposedAvatar(reference?.kind === 'composed' ? reference : undefined, size, false, view)
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(() => new Set())
  const builtinId = reference?.kind === 'builtin' ? reference.id : undefined
  // Coding Agents show their engine mark in a rounded square, never a portrait.
  const engine = reference?.kind === 'harness' ? reference.harnessId : undefined
  const selected = ROOM_AVATARS.find((item) => item.id === builtinId)
  // Every avatar is a rounded square; small ones only drop the name badge (rooms-avatars.css).
  const compact = size <= 48
  const style = {
    '--rooms-avatar-size': `${size / 16}rem`,
    '--rooms-avatar-tone': identityTone(identity),
    background: reference?.kind === 'composed' && reference.parts.bg === 'transparent' ? 'transparent' : undefined
  } as CSSProperties
  const image = composed && !failedImages.has(composed) ? composed
    : uploaded && !failedImages.has(uploaded) ? uploaded
    : isUser && !selected && !failedImages.has(kunGreet) ? kunGreet : undefined
  const content = engine ? <AgentIcon harnessId={engine} size={Math.round(size * 0.58)} /> : (
    <>
      {image ? (
        <img key={image} className={`rooms-avatar-art ${image === kunGreet ? 'rooms-user-kun' : 'object-cover'}`}
          data-composed={image === composed || undefined}
          src={image} alt="" aria-hidden="true" onError={() => setFailedImages((failed) => new Set([...failed, image]))} />
      ) : (
        <RoomAvatarPortrait index={selected?.index ?? avatarForIdentity(identity).index} />
      )}
      {!isUser ? <span className="rooms-avatar-letter" aria-hidden="true">
        {Array.from(label.trim())[0]?.toLocaleUpperCase() ?? 'K'}
      </span> : null}
    </>
  )
  return onClick ? (
    <button
      type="button"
      className="rooms-avatar rooms-avatar-button"
      data-compact={compact || undefined}
      data-framing={view}
      data-engine={engine}
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
      data-compact={compact || undefined}
      data-framing={view}
      data-engine={engine}
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
  avatar,
  id,
  label: explicitLabel,
  size = 44,
  onClick
}: {
  members: RoomMember[]
  avatar?: RoomAvatarReference | null
  id?: string
  label?: string
  size?: number
  onClick?: () => void
}) {
  const active = members.filter((member) => !member.removedAt)
  // Two members overlap diagonally; larger groups use a 2x2 grid whose last
  // cell counts the members that do not fit.
  const overflow = active.length > 4 ? active.length - 3 : 0
  const visible = active.slice(0, overflow ? 3 : 4)
  const label = explicitLabel ?? (active.map((member) => member.displayName).join(', ') || 'Kun')
  // Members render at their tile size, so small tiles use the face crop and the right resolution.
  const tile = Math.round(size * (visible.length <= 1 ? 1 : visible.length === 2 && !overflow ? 0.66 : 0.5))
  if (avatar) {
    return <RoomAvatar avatar={avatar} id={id} label={label} size={size} onClick={onClick} />
  }
  const className = `rooms-avatar-group rooms-avatar-group-${Math.min(4, Math.max(1, active.length))}`
  const style = { '--rooms-avatar-size': `${size / 16}rem` } as CSSProperties
  const content = visible.length ? (
    <>
      {visible.map((member) => (
        <RoomAvatar
          key={member.id}
          member={member}
          label={member.displayName}
          size={tile}
        />
      ))}
      {overflow ? <span className="rooms-avatar-group-more" aria-hidden="true">+{overflow}</span> : null}
    </>
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
