import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { KunAvatarParts } from '@shared/rooms-api'
import { RoomModal } from '../rooms/RoomModal'
import { composedAvatarLayerUrl } from '../rooms/room-avatar-compositor'
import { SharePosterEditor, type PosterActions, type PosterLabels } from './share-poster/SharePosterEditor'

const art = import.meta.glob('../../../../asset/img/kun-share/*.webp', { eager: true, query: '?url&no-inline', import: 'default' }) as Record<string, string>
const resources = {
  layerUrl: (key: string) => composedAvatarLayerUrl(key, 512),
  artUrl: (name: string) => art[`../../../../asset/img/kun-share/${name}`]
}
async function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
function shareApi() {
  const api = window.kunGui?.kunAccount?.wardrobe
  if (!api) throw new Error('account-unavailable')
  return api
}
const actions: PosterActions = {
  save: async (blob, fileName) => shareApi().saveSharePoster({ dataBase64: await base64(blob), fileName }),
  copy: async (blob) => {
    const result = await window.kunGui.writeClipboardImage({ dataBase64: await base64(blob), mimeType: 'image/png' })
    if (!result.ok) throw new Error('clipboard-unavailable')
  },
  copyLink: (link) => navigator.clipboard.writeText(link),
  reveal: () => shareApi().revealSharePoster()
}
export function WardrobeSharePoster({ look, code, link, onClose, onRetry }: {
  look: KunAvatarParts; code: string; link: string; onClose: () => void; onRetry: () => void
}) {
  const { t, i18n } = useTranslation('common')
  const [busy, setBusy] = useState(false)
  const labels = t('wardrobeShare', { returnObjects: true }) as unknown as PosterLabels
  return <RoomModal title={labels.title} onClose={onClose} busy={busy} size="wide">
    <SharePosterEditor input={{ look, code, link, language: i18n.language }} labels={labels} resources={resources} actions={actions} onRetry={onRetry} onBusy={setBusy} />
  </RoomModal>
}
