import { useEffect, useState } from 'react'
import { ExternalLink, Link } from 'lucide-react'
import type { RoomLinkPreview as Preview, RoomPreviewImage } from '@shared/rooms-api'
import { firstRoomBodyUrl } from '@shared/room-content-text'
import { useTranslation } from 'react-i18next'
import { useRoomContentVisibility } from './room-content-client'
import { useRoomPresentationPreferences } from './room-presentation-preferences'
import { roomsRequest } from './rooms-client'
import './rooms-content.css'

export const firstPublicRoomLink = firstRoomBodyUrl
/** Mounted only for ordinary public room messages; traces and input drafts never enter this component. */
export function RoomLinkPreview({ roomId, messageId, body }: { roomId: string; messageId: string; body: string }) {
  const { t } = useTranslation('common')
  const automatic = useRoomPresentationPreferences((state) => state.autoLinkPreviews)
  const firstUrl = firstPublicRoomLink(body)
  const { ref, visible } = useRoomContentVisibility('0px', automatic && Boolean(firstUrl))
  const [preview, setPreview] = useState<Preview | null>(null), [image, setImage] = useState<RoomPreviewImage | null>(null)
  useEffect(() => {
    if (!automatic || !visible || !firstUrl) { setPreview(null); setImage(null); return }
    const controller = new AbortController()
    const path = `/v1/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/link-preview`
    setPreview(null); setImage(null)
    void roomsRequest<{ preview: Preview }>(path, 'GET', undefined, controller.signal).then(async ({ preview: next }) => {
      if (controller.signal.aborted) return
      setPreview(next)
      if (next.state === 'available' && next.hasImage) {
        const result = await roomsRequest<{ image?: RoomPreviewImage }>(path + '/image', 'GET', undefined, controller.signal)
        if (!controller.signal.aborted) setImage(result.image ?? null)
      }
    }).catch(() => undefined)
    return () => controller.abort()
  }, [automatic, visible, firstUrl, roomId, messageId])
  if (!firstUrl || !automatic) return null
  return <div ref={ref} className="rooms-link-preview-anchor">
    {preview?.state === 'available' ? <button className="rooms-link-preview" type="button"
      onClick={() => { if (preview.url) void window.kunGui.openExternal(preview.url) }}>
      {image ? <img loading="lazy" alt="" src={`data:${image.mimeType};base64,${image.dataBase64}`} width={image.width} height={image.height} /> : null}
      <span><small><Link size={12} />{preview.siteName}</small><strong>{preview.title}</strong>
        {preview.description ? <span>{preview.description}</span> : null}</span><ExternalLink size={14} />
    </button> : preview?.state === 'unavailable' ? <span className="rooms-link-preview-unavailable">{t('roomsContentLinkUnavailable')}</span> : null}
  </div>
}
