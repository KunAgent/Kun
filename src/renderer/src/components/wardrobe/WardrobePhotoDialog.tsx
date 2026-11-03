import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomAvatarReference, RoomPreviewImage } from '@shared/rooms-api'
import { RoomModal } from '../rooms/RoomModal'
import { cacheRoomAvatar } from '../rooms/room-uploaded-avatar'
import { roomsRequest } from '../rooms/rooms-client'

/** Bounds match the avatar editor; the server normalizes again. */
export async function readWardrobePhoto(file: File): Promise<ImageBitmap> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('unsupported')
  const bitmap = await createImageBitmap(file)
  if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16 * 1024 * 1024) { bitmap.close(); throw new Error('unsupported') }
  return bitmap
}

/** Crops a chosen picture to a square, uploads it and hands back the avatar reference to wear. */
export function WardrobePhotoDialog({ source, onClose, onDone }: {
  source: ImageBitmap; onClose: () => void; onDone: (avatar: RoomAvatarReference) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const canvas = useRef<HTMLCanvasElement>(null)
  const [position, setPosition] = useState({ x: 50, y: 50 })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => () => source.close(), [source])
  // Keep preview and payload identical: the uploaded picture is exactly what the canvas shows.
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const side = Math.min(source.width, source.height)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 256, 256)
    ctx.drawImage(source, (source.width - side) * position.x / 100, (source.height - side) * position.y / 100, side, side, 0, 0, 256, 256)
  }, [source, position])
  const save = async () => {
    if (!canvas.current || busy) return
    setBusy(true); setError('')
    try {
      const result = await roomsRequest<{ avatar: RoomAvatarReference; image: RoomPreviewImage }>('/v1/rooms/avatars', 'POST', {
        dataBase64: canvas.current.toDataURL('image/jpeg', 0.9).split(',')[1], mimeType: 'image/jpeg' })
      if (result.avatar.kind === 'uploaded') cacheRoomAvatar(result.avatar.attachmentId, result.image)
      onDone(result.avatar)
    } catch (cause) { setError(String(cause)); setBusy(false) }
  }
  return <RoomModal title={t('wardrobePagePhotoTitle')} onClose={onClose} busy={busy}>
    <div className="kun-wardrobe-photo">
      <div className="rooms-avatar-preview"><canvas width={256} height={256} ref={canvas} aria-label={t('roomsAvatarCropPreview')} /></div>
      <div className="rooms-avatar-crop-controls">
        <label>{t('roomsAvatarCropHorizontal')}<input type="range" min="0" max="100" value={position.x} disabled={busy}
          onChange={(event) => setPosition({ ...position, x: Number(event.target.value) })} /></label>
        <label>{t('roomsAvatarCropVertical')}<input type="range" min="0" max="100" value={position.y} disabled={busy}
          onChange={(event) => setPosition({ ...position, y: Number(event.target.value) })} /></label>
      </div>
      <small>{t('roomsAvatarFileHint')}</small>
      {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
      <div className="rooms-avatar-draft-actions">
        <button type="button" disabled={busy} onClick={onClose}>{t('roomsCancel')}</button>
        <button type="button" className="rooms-run-primary" disabled={busy} onClick={() => void save()}>{t(busy ? 'roomsLoading' : 'agentsSave')}</button>
      </div>
    </div>
  </RoomModal>
}
