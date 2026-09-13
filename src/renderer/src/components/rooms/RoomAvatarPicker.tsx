import { useRef, useState } from 'react'
import { Check, Upload, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RoomMember, RoomAvatarReference, RoomPreviewImage } from '@shared/rooms-api'
import { RoomAvatar, RoomAvatarPortrait } from './RoomAvatar'
import { ROOM_AVATARS, avatarForIdentity } from './room-avatar-catalog'
import { RoomPopover } from './RoomPopover'
import { roomsRequest } from './rooms-client'
import { cacheRoomAvatar } from './room-uploaded-avatar'
import './rooms-content.css'

async function imageUpload(file: File): Promise<{ dataBase64: string; mimeType: 'image/jpeg' }> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('unsupported_avatar')
  const bitmap = await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > 16 * 1024 * 1024) throw new Error('unsupported_avatar')
    const canvas = document.createElement('canvas')
    canvas.width = 256; canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) throw new Error('avatar_unavailable')
    const side = Math.min(bitmap.width, bitmap.height)
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256)
    return { dataBase64: canvas.toDataURL('image/jpeg', 0.9).split(',')[1], mimeType: 'image/jpeg' }
  } finally { bitmap.close() }
}

export function RoomAvatarPicker({ member, onChange }: { member: RoomMember; onChange: (avatar: RoomAvatarReference | undefined) => void }) {
  const { t } = useTranslation('common')
  const file = useRef<HTMLInputElement>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const avatar = member.avatar
  const selected = avatar?.kind === 'builtin' ? avatar.id : avatar ? '' : avatarForIdentity(member.id).id
  return <div className="rooms-avatar-picker-field">
    <RoomAvatar member={member} label={member.displayName} size={48} />
    <RoomPopover label={t('roomsAvatarChoose')} trigger={<span>{t('roomsAvatarChoose')}</span>} disabled={busy} width={320}>
      {(close) => <div className="rooms-avatar-picker">
        <div className="rooms-avatar-picker-grid">{ROOM_AVATARS.map((portrait) => <button type="button" key={portrait.id}
          className="rooms-avatar-picker-option" aria-label={portrait.label} aria-pressed={selected === portrait.id}
          onClick={() => { onChange({ kind: 'builtin', id: portrait.id }); setError(''); close() }}>
          <RoomAvatarPortrait index={portrait.index} />{selected === portrait.id ? <Check size={14} /> : null}
        </button>)}</div>
        <button type="button" onClick={() => { file.current?.click(); close() }}><Upload size={14} />{t('roomsAvatarUpload')}</button>
        <button type="button" onClick={() => { onChange(undefined); close() }}><X size={14} />{t('roomsAvatarReset')}</button>
      </div>}
    </RoomPopover>
    <input hidden ref={file} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
      const selected = event.target.files?.[0]
      if (!selected) return
      setBusy(true); setError('')
      void imageUpload(selected).then((body) => roomsRequest<{ avatar: RoomAvatarReference; image: RoomPreviewImage }>('/v1/rooms/avatars', 'POST', body))
        .then((result) => { if (result.avatar.kind === 'uploaded') cacheRoomAvatar(result.avatar.attachmentId, result.image); onChange(result.avatar) })
        .catch(() => setError(t('roomsAvatarUploadFailed'))).finally(() => { setBusy(false); if (file.current) file.current.value = '' })
    }} />
    {busy ? <span>{t('roomsLoading')}</span> : null}
    {error ? <span role="alert">{error}</span> : null}
  </div>
}
