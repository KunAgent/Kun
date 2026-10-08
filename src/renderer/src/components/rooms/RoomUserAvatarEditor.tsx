import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomAvatarReference, RoomPreviewImage, RoomUserProfileDetail } from '@shared/rooms-api'
import type { KunWardrobeDrop } from '@shared/rooms-api'
import { RoomModal } from './RoomModal'
import { RoomAvatarComposer, editableKunAvatarParts } from './RoomAvatarComposer'
import { RoomWardrobeProgress } from './RoomWardrobeProgress'
import { RoomWardrobeReveal } from './RoomWardrobeReveal'
import { markWardrobeSeen, openWardrobeDrop, useWardrobe, wardrobeGate, wearWardrobeDrop, type WardrobeOpenResult } from './room-wardrobe'
import { roomsRequest, roomRequestId } from './rooms-client'
import { cacheRoomAvatar } from './room-uploaded-avatar'
import { acceptRoomUserProfile } from './room-user-profile'
import { useAgentResource } from './agent-client'

export function RoomUserAvatarEditor({ onClose, variant = 'modal' }: { onClose: () => void; variant?: 'modal' | 'panel' }) {
  const { t } = useTranslation('common')
  const [busy, setBusy] = useState(false)
  const detail = useAgentResource<RoomUserProfileDetail>('/v1/rooms/user-profile')
  const body = detail.data ? <UserAvatarForm initial={detail.data} onClose={onClose} onBusy={setBusy} /> : <p role={detail.error ? 'alert' : undefined}>{detail.error || t('roomsLoading')}</p>
  return variant === 'panel' ? <div className="min-h-0 flex-1 overflow-y-auto p-4">{body}</div>
    : <RoomModal title={t('roomsMyAvatar')} size="wide" onClose={onClose} busy={busy}>{body}</RoomModal>
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
  const wardrobe = useWardrobe()
  const [reveal, setReveal] = useState<WardrobeOpenResult | null>(null), [opening, setOpening] = useState(false)
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
    setBusy(true); onBusy(true); setError('')
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size > 2 * 1024 * 1024) throw new Error('unsupported')
      const bitmap = await createImageBitmap(selected)
      if (!mounted.current || serial !== loadSerial.current) { bitmap.close(); return }
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16 * 1024 * 1024) { bitmap.close(); throw new Error('unsupported') }
      setPosition({ x: 50, y: 50 }); setSource(bitmap)
    } catch { if (mounted.current && serial === loadSerial.current) setError(t('roomsAvatarInvalidFile')) }
    finally { if (mounted.current && serial === loadSerial.current) { setBusy(false); onBusy(false) } }
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
  const openBottle = async (drop: KunWardrobeDrop) => {
    setOpening(true); setError('')
    try { setReveal(await openWardrobeDrop(drop.id)) } catch (cause) { if (mounted.current) setError(String(cause)) }
    finally { if (mounted.current) setOpening(false) }
  }
  const wear = (drop: KunWardrobeDrop) => select({ kind: 'composed', version: 1,
    parts: wearWardrobeDrop(editableKunAvatarParts(avatar, 'user-preview', true), drop) })
  return <div className="rooms-user-avatar-form">
    <RoomWardrobeProgress state={wardrobe} busy={busy || opening} onOpen={(drop) => void openBottle(drop)} />
    <RoomAvatarComposer id="user-preview" label={t('roomsMyAvatar')} avatar={avatar} user disabled={busy} photo={!!source}
      wardrobe={wardrobeGate(wardrobe)} onSeen={(keys) => void markWardrobeSeen(keys).catch(() => undefined)}
      onChange={select} onUpload={() => file.current?.click()}
      preview={source ? <div className="rooms-avatar-preview"><canvas width={256} height={256} ref={preview} aria-label={t('roomsAvatarCropPreview')} /></div> : undefined}
      previewControls={source ? <div className="rooms-avatar-crop-controls">
        <label>{t('roomsAvatarCropHorizontal')}<input type="range" min="0" max="100" value={position.x} disabled={busy} onChange={(e) => setPosition({ ...position, x: Number(e.target.value) })} /></label>
        <label>{t('roomsAvatarCropVertical')}<input type="range" min="0" max="100" value={position.y} disabled={busy} onChange={(e) => setPosition({ ...position, y: Number(e.target.value) })} /></label>
      </div> : undefined} />
    <input ref={file} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
      const selected = e.target.files?.[0]; e.target.value = ''; if (selected) void chooseFile(selected)
    }} />
    <small>{t('roomsAvatarFileHint')}</small>
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
    {reveal ? <RoomWardrobeReveal result={reveal} onClose={() => setReveal(null)} onWear={() => wear(reveal.drop)} /> : null}
    <div className="rooms-avatar-draft-actions"><button type="button" disabled={busy} onClick={onClose}>{t('roomsCancel')}</button>
      <button type="button" className="rooms-run-primary" disabled={busy} onClick={() => void save()}>{t(busy ? 'roomsLoading' : 'agentsSave')}</button></div>
  </div>
}
