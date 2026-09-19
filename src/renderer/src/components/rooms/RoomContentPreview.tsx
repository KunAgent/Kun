import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Image } from 'lucide-react'
import type { Room, RoomContentReference, RoomContentOpenTarget } from '@shared/rooms-api'
import { AssistantMarkdown } from '../chat/AssistantMarkdown'
import { useRoomContent, roomContentStatusKey } from './room-content-client'
import { RoomImageLightbox } from './RoomImageLightbox'
import './rooms-content.css'

export function RoomContentPreview({ room, reference, messageId, onOpenTarget, onOpenCode }: {
  room: Room
  reference: RoomContentReference
  messageId?: string
  onOpenTarget?: (target: RoomContentOpenTarget) => void | Promise<void>
  onOpenCode?: (threadId: string, turnId?: string) => void | Promise<void>
}) {
  const { t } = useTranslation('common')
  const [retry, setRetry] = useState(0), [expanded, setExpanded] = useState(false), [navigationError, setNavigationError] = useState('')
  const { result, error, loading } = useRoomContent(room, reference, 'preview', true, messageId, retry)
  if (loading) return <p className="rooms-content-loading">{t('roomsLoading')}</p>
  if (error || result?.state !== 'available') return <section className="rooms-content-preview" role="status">
    <h3>{reference.titleSnapshot ?? t('roomsContentUnavailable')}</h3><p>{t('roomsContentUnavailable')}</p>
    <button type="button" onClick={() => setRetry((value) => value + 1)}>{t('roomsContentRetry')}</button>
  </section>
  const target = result.openTarget
  const canOpen = target && (onOpenTarget || target.kind === 'thread' && onOpenCode)
  return <section className="rooms-content-preview">
    <header><h3>{result.title}</h3>{result.status ? <span>{t(roomContentStatusKey(result.kind, result.status), { defaultValue: result.status })}</span> : null}</header>
    {result.version ? <p className="rooms-content-version">{t('roomsContentVersion')} · {result.version}</p> : null}
    {result.description ? <p>{result.description}</p> : null}
    {result.preview?.type === 'text' ? <div className="rooms-content-document">
      {reference.kind === 'repository_file' && /\.mdx?$/.test(reference.relativePath)
        ? <AssistantMarkdown text={result.preview.text} streaming={false} />
        : <pre>{result.preview.text}</pre>}
      {result.preview.truncated ? <p>{t('roomsContentTruncated')}</p> : null}
    </div> : result.preview?.type === 'image' ? <button type="button" className="rooms-content-image-preview" onClick={() => setExpanded(true)}>
      <img src={`data:${result.preview.image.mimeType};base64,${result.preview.image.dataBase64}`} alt={result.title} />
      <span><Image size={14} /> {t('roomsContentExpandImage')}</span>
    </button> : <p>{t('roomsContentNoInlinePreview')}</p>}
    {canOpen ? <button type="button" className="rooms-content-open" onClick={() => {
      setNavigationError('')
      void Promise.resolve(onOpenTarget ? onOpenTarget(target) : target.kind === 'thread' ? onOpenCode?.(target.threadId, target.turnId) : undefined)
        .catch((cause) => setNavigationError(String(cause)))
    }}><ExternalLink size={14} />{t(target.kind === 'board' ? 'roomsContentOpenBoard' : target.kind === 'work_file' ? 'roomsContentOpenWork' : 'roomsContentOpenCode')}</button> : null}
    {navigationError ? <p role="alert">{navigationError}</p> : null}
    {expanded && result.preview?.type === 'image' ? <RoomImageLightbox title={result.title} image={result.preview.image} onClose={() => setExpanded(false)} /> : null}
  </section>
}
