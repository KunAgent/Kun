import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomAvatarReference, RoomPreviewImage } from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { RoomAvatarComposer } from './RoomAvatarComposer'
import { RoomModal } from './RoomModal'
import { roomsRequest } from './rooms-client'
import { cacheRoomAvatar } from './room-uploaded-avatar'
import './rooms-content.css'

type AvatarUpload = { dataBase64: string; mimeType: 'image/jpeg' }
async function imageUpload(file: File): Promise<AvatarUpload> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('unsupported_avatar')
  const bitmap = await createImageBitmap(file)
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16 * 1024 * 1024) throw new Error('unsupported_avatar')
    const canvas = document.createElement('canvas')
    canvas.width = 256; canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) throw new Error('avatar_unavailable')
    const side = Math.min(bitmap.width, bitmap.height)
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 256, 256)
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256)
    return { dataBase64: canvas.toDataURL('image/jpeg', 0.9).split(',')[1], mimeType: 'image/jpeg' }
  } finally { bitmap.close() }
}

function AvatarPickerDraft({ id, label, initial, fallback, onChange, onClose, onBusy }: {
  id: string; label: string; initial?: RoomAvatarReference; fallback?: ReactNode
  onChange: (avatar: RoomAvatarReference | undefined) => void; onClose: () => void; onBusy: (busy: boolean) => void
}) {
  const { t } = useTranslation('common')
  const [avatar, setAvatar] = useState<RoomAvatarReference | null | undefined>(initial)
  const [upload, setUpload] = useState<AvatarUpload | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const mounted = useRef(true), loadSerial = useRef(0), file = useRef<HTMLInputElement>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const select = (next: RoomAvatarReference | null) => { loadSerial.current++; setUpload(null); setAvatar(next); setError('') }
  const chooseFile = async (selected: File) => {
    const serial = ++loadSerial.current
    setBusy(true); onBusy(true); setError('')
    try {
      const next = await imageUpload(selected)
      if (mounted.current && serial === loadSerial.current) setUpload(next)
    } catch { if (mounted.current && serial === loadSerial.current) setError(t('roomsAvatarUploadFailed')) }
    finally { if (mounted.current && serial === loadSerial.current) { setBusy(false); onBusy(false) } }
  }
  const save = async () => {
    if (busy) return
    setBusy(true); onBusy(true); setError('')
    try {
      let selected = avatar ?? undefined
      if (upload) {
        const result = await roomsRequest<{ avatar: RoomAvatarReference; image: RoomPreviewImage }>('/v1/rooms/avatars', 'POST', upload)
        selected = result.avatar
        if (selected.kind === 'uploaded') cacheRoomAvatar(selected.attachmentId, result.image)
      }
      if (mounted.current) { onChange(selected); onClose() }
    } catch { if (mounted.current) setError(t('roomsAvatarUploadFailed')) }
    finally { if (mounted.current) { setBusy(false); onBusy(false) } }
  }
  return <div className="rooms-avatar-draft">
    <RoomAvatarComposer id={id} label={label} avatar={avatar} disabled={busy} photo={!!upload} onChange={select}
      onUpload={() => file.current?.click()} preview={upload ? <img alt={t('roomsAvatarCropPreview')} src={`data:image/jpeg;base64,${upload.dataBase64}`} /> : !avatar ? fallback : undefined} />
    <input hidden ref={file} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
      const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void chooseFile(selected)
    }} />
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
    <div className="rooms-avatar-draft-actions">
      <button type="button" disabled={busy} onClick={onClose}>{t('roomsCancel')}</button>
      <button type="button" className="rooms-run-primary" disabled={busy} onClick={() => void save()}>{t(busy ? 'roomsLoading' : 'agentsSave')}</button>
    </div>
  </div>
}

export function RoomAvatarPicker({ id, label, avatar, fallback, onChange }: {
  id: string; label: string; avatar?: RoomAvatarReference; fallback?: ReactNode
  onChange: (avatar: RoomAvatarReference | undefined) => void
}) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false)
  const close = () => { setOpen(false); setBusy(false) }
  return <div className="rooms-avatar-picker-field">
    {avatar ? <RoomAvatar avatar={avatar} id={id} label={label} size={48} /> : fallback ?? <RoomAvatar id={id} label={label} size={48} />}
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{t('roomsAvatarChoose')}</button>
    {open ? <RoomModal title={t('roomsAvatarChoose')} onClose={close} busy={busy}>
      <AvatarPickerDraft id={id} label={label} initial={avatar} fallback={fallback} onChange={onChange} onClose={close} onBusy={setBusy} />
    </RoomModal> : null}
  </div>
}
