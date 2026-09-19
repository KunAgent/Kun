import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomAvatarReference, RoomPreviewImage, RoomUserProfileDetail } from '@shared/rooms-api'
import { RoomModal } from './RoomModal'
import { RoomAvatar, RoomAvatarPortrait } from './RoomAvatar'
import { ROOM_AVATARS } from './room-avatar-catalog'
import { roomsRequest, roomRequestId } from './rooms-client'
import { cacheRoomAvatar } from './room-uploaded-avatar'
import { acceptRoomUserProfile } from './room-user-profile'
import { useAgentResource } from './agent-client'

export function RoomUserAvatarEditor({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common')
  const [busy, setBusy] = useState(false)
  const detail = useAgentResource<RoomUserProfileDetail>('/v1/rooms/user-profile')
  return <RoomModal title={t('roomsMyAvatar')} onClose={onClose} busy={busy}>
    {detail.data ? <UserAvatarForm initial={detail.data} onClose={onClose} onBusy={setBusy} /> : <p role={detail.error ? 'alert' : undefined}>{detail.error || t('roomsLoading')}</p>}
  </RoomModal>
}
function UserAvatarForm({ initial, onClose, onBusy }: { initial: RoomUserProfileDetail; onClose: () => void; onBusy: (busy: boolean) => void }) {
  const { t } = useTranslation('common')
  const [original] = useState(initial)
  const [avatar, setAvatar] = useState(original.profile.avatar)
  const [source, setSource] = useState<ImageBitmap | null>(null)
  const [position, setPosition] = useState({ x: 50, y: 50 })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const preview = useRef<HTMLCanvasElement>(null), file = useRef<HTMLInputElement>(null)
  const mounted = useRef(true), loadSerial = useRef(0)
  const pending = useRef<{ key: string; id: string } | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => () => source?.close(), [source])
  // Keep preview and payload identical; the server performs its own bounded normalization.
  const renderPreview = () => {
    if (!source || !preview.current) return
    const canvas = preview.current, ctx = canvas.getContext('2d')!
    const side = Math.min(source.width, source.height)
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256)
    ctx.drawImage(source, (source.width - side) * position.x / 100, (source.height - side) * position.y / 100, side, side, 0, 0, 256, 256)
  }
  useEffect(renderPreview, [source, position])
  const chooseFile = async (selected: File) => {
    const serial = ++loadSerial.current
    setError('')
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size > 2 * 1024 * 1024) throw new Error('unsupported')
      const bitmap = await createImageBitmap(selected)
      if (!mounted.current || serial !== loadSerial.current) { bitmap.close(); return }
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16 * 1024 * 1024) { bitmap.close(); throw new Error('unsupported') }
      setPosition({ x: 50, y: 50 }); setSource(bitmap)
    } catch { if (mounted.current && serial === loadSerial.current) setError(t('roomsAvatarInvalidFile')) }
  }
  const save = async () => {
    if (busy) return
    setBusy(true); onBusy(true); setError('')
    try {
      let selected: RoomAvatarReference | null = avatar
      if (source && preview.current) {
        renderPreview()
        const result = await roomsRequest<{ avatar: RoomAvatarReference; image: RoomPreviewImage }>('/v1/rooms/avatars', 'POST', {
          dataBase64: preview.current.toDataURL('image/jpeg', 0.9).split(',')[1], mimeType: 'image/jpeg' })
        selected = result.avatar
        if (selected.kind === 'uploaded') cacheRoomAvatar(selected.attachmentId, result.image)
      }
      const key = JSON.stringify(selected)
      if (pending.current?.key !== key) pending.current = { key, id: roomRequestId() }
      const saved = await roomsRequest<RoomUserProfileDetail>('/v1/rooms/user-profile', 'PUT', {
        avatar: selected, expectedRevision: original.revision, clientRequestId: pending.current.id })
      acceptRoomUserProfile(saved)
      if (mounted.current) onClose()
    } catch (cause) { if (mounted.current) setError(String(cause)) }
    finally { if (mounted.current) { setBusy(false); onBusy(false) } }
  }
  const select = (next: RoomAvatarReference | null) => { loadSerial.current++; setSource(null); setAvatar(next); setError('') }
  return <div className="rooms-user-avatar-form">
    <div className="rooms-avatar-preview">{source ? <canvas width={256} height={256} ref={preview} aria-label={t('roomsAvatarCropPreview')} /> :
      <RoomAvatar id="user-preview" user avatar={avatar} label={t('roomsMyAvatar')} size={128} />}</div>
    {source ? <div className="rooms-avatar-crop-controls">
      <label>{t('roomsAvatarCropHorizontal')}<input type="range" min="0" max="100" value={position.x} disabled={busy} onChange={(e) => setPosition({ ...position, x: Number(e.target.value) })} /></label>
      <label>{t('roomsAvatarCropVertical')}<input type="range" min="0" max="100" value={position.y} disabled={busy} onChange={(e) => setPosition({ ...position, y: Number(e.target.value) })} /></label>
    </div> : null}
    <div className="rooms-avatar-picker-grid">{ROOM_AVATARS.map((portrait) => <button type="button" key={portrait.id} className="rooms-avatar-picker-option"
      disabled={busy} aria-label={portrait.label} aria-pressed={!source && avatar?.kind === 'builtin' && avatar.id === portrait.id}
      onClick={() => select({ kind: 'builtin', id: portrait.id })}><RoomAvatarPortrait index={portrait.index} /></button>)}</div>
    <div className="rooms-avatar-editor-actions">
      <button type="button" disabled={busy} onClick={() => file.current?.click()}>{t('roomsAvatarUpload')}</button>
      <button type="button" disabled={busy} onClick={() => select(null)}>{t('roomsAvatarRestoreKun')}</button>
    </div>
    <input ref={file} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
      const selected = e.target.files?.[0]; e.target.value = ''; if (selected) void chooseFile(selected)
    }} />
    <small>{t('roomsAvatarFileHint')}</small>
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
    <div className="rooms-avatar-editor-actions"><button type="button" disabled={busy} onClick={onClose}>{t('roomsCancel')}</button>
      <button type="button" className="rooms-run-primary" disabled={busy} onClick={() => void save()}>{t(busy ? 'roomsLoading' : 'agentsSave')}</button></div>
  </div>
}
