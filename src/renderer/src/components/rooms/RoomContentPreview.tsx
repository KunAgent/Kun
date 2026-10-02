import { RoomArtifactVersions } from './RoomArtifactVersions'
import { RoomArtifactExport } from './RoomArtifactExport'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Image } from 'lucide-react'
import type { Room, RoomContentReference, RoomContentOpenTarget, RoomArtifactSourceTarget } from '@shared/rooms-api'
import { AssistantMarkdown } from '../chat/AssistantMarkdown'
import { useRoomContent, roomContentStatusKey, roomContentKey } from './room-content-client'
import { RoomImageLightbox } from './RoomImageLightbox'
import './rooms-content.css'

type RoomContentPreviewProps = {
  room: Room
  reference: RoomContentReference
  messageId?: string
  onOpenTarget?: (target: RoomContentOpenTarget) => void | Promise<void>
  onOpenCode?: (threadId: string, turnId?: string) => void | Promise<void>
  onOpenSource?: (target: RoomArtifactSourceTarget) => void | Promise<void>
}
export function RoomContentPreview(props: RoomContentPreviewProps) {
  // Reset before render: an effect-only reset can request a new file with the previous file's selected version.
  const key = JSON.stringify([props.room.id, props.room.members[0]?.participantAgentId, roomContentKey(props.reference), props.messageId])
  return <RoomContentPreviewBody key={key} {...props} />
}
function RoomContentPreviewBody({ room, reference, messageId, onOpenTarget, onOpenCode, onOpenSource }: RoomContentPreviewProps) {
  const { t } = useTranslation('common')
  const [retry, setRetry] = useState(0), [expanded, setExpanded] = useState('')
  const [navigationError, setNavigationError] = useState<{ scope: string; message: string } | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<number | undefined>()
  const currentReference = reference.kind === 'agent_file' && selectedVersion ? { ...reference, artifactVersion: selectedVersion } : reference
  const scope = roomContentKey(currentReference), current = useRef(scope), mounted = useRef(true)
  current.current = scope
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const navigate = (action: () => void | Promise<void>) => {
    setNavigationError(null)
    void Promise.resolve().then(() => { if (mounted.current && current.current === scope) return action() })
      .catch((cause) => { if (mounted.current && current.current === scope) setNavigationError({ scope, message: String(cause) }) })
  }
  // Explicit version navigation is authorized by the artifact's Agent ownership, not a mismatched message snapshot.
  const currentMessage = selectedVersion ? undefined : messageId
  const { result, error, loading } = useRoomContent(room, currentReference, 'preview', true, currentMessage, retry)
  if (loading) return <p className="rooms-content-loading">{t('roomsLoading')}</p>
  if (error || result?.state !== 'available') return <section className="rooms-content-preview" role="status">
    <h3>{reference.titleSnapshot ?? t('roomsContentUnavailable')}</h3><p>{t('roomsContentUnavailable')}</p>
    <button type="button" onClick={() => setRetry((value) => value + 1)}>{t('roomsContentRetry')}</button>
  </section>
  const target = result.openTarget
  const canOpen = target && (onOpenTarget || target.kind === 'thread' && onOpenCode)
  const source = result.sourceTarget
  const scopedSource = room.conversationKind === 'user_agent' && source?.roomId === room.id &&
    source.participantAgentId === room.members[0]?.participantAgentId ? source : undefined
  return <section className="rooms-content-preview">
    <header><h3>{result.title}</h3>{result.status ? <span>{t(roomContentStatusKey(result.kind, result.status), { defaultValue: result.status })}</span> : null}</header>
    {result.version ? <p className="rooms-content-version">{t('roomsContentVersion')} · {result.version}</p> : null}
    {result.description ? <p>{result.description}</p> : null}
    {result.preview?.type === 'text' ? <div className="rooms-content-document">
      {reference.kind === 'repository_file' && /\.mdx?$/.test(reference.relativePath)
        ? <AssistantMarkdown text={result.preview.text} streaming={false} />
        : <pre>{result.preview.text}</pre>}
      {result.preview.truncated ? <p>{t('roomsContentTruncated')}</p> : null}
    </div> : result.preview?.type === 'image' ? <button type="button" className="rooms-content-image-preview" onClick={() => setExpanded(scope)}>
      <img src={`data:${result.preview.image.mimeType};base64,${result.preview.image.dataBase64}`} alt={result.title} />
      <span><Image size={14} /> {t('roomsContentExpandImage')}</span>
    </button> : <p>{t('roomsContentNoInlinePreview')}</p>}
    {canOpen ? <button type="button" className="rooms-content-open" onClick={() => navigate(() => onOpenTarget ? onOpenTarget(target) : target.kind === 'thread' ? onOpenCode?.(target.threadId, target.turnId) : undefined)}><ExternalLink size={14} />{t(target.kind === 'board' || target.kind === 'excalidraw_board' ? 'roomsContentOpenBoard' : target.kind === 'work_file' ? 'roomsContentOpenWork' : 'roomsContentOpenCode')}</button> : null}
    {scopedSource && onOpenSource ? <button type="button" className="rooms-artifact-source"
      onClick={() => navigate(() => onOpenSource(scopedSource))}><ExternalLink size={14} />
      {t('roomsArtifactOpenSource', { defaultValue: 'View source conversation' })}</button>
      : reference.kind === 'agent_file' && reference.artifactId && !scopedSource
        ? <p className="rooms-artifact-source-unavailable">{t('roomsArtifactSourceUnavailable', { defaultValue: 'Source conversation unavailable' })}</p> : null}
    <RoomArtifactVersions room={room} reference={currentReference} onVersion={setSelectedVersion} />
    <RoomArtifactExport room={room} reference={currentReference} />
    {navigationError?.scope === scope ? <p role="alert">{navigationError.message}</p> : null}
    {expanded === scope && result.preview?.type === 'image' ? <RoomImageLightbox title={result.title} image={result.preview.image} onClose={() => setExpanded('')} /> : null}
  </section>
}
