import { RoomArtifactVersions } from './RoomArtifactVersions'
import { RoomArtifactExport } from './RoomArtifactExport'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Files, Image } from 'lucide-react'
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
  variant?: 'drawer' | 'workbench'
  onFiles?: () => void
}
export function RoomContentPreview(props: RoomContentPreviewProps) {
  // Reset before render: an effect-only reset can request a new file with the previous file's selected version.
  const key = JSON.stringify([props.room.id, props.room.members[0]?.participantAgentId, roomContentKey(props.reference), props.messageId])
  return <RoomContentPreviewBody key={key} {...props} />
}
function RoomContentPreviewBody({ room, reference, messageId, onOpenTarget, onOpenCode, onOpenSource, variant = 'drawer', onFiles }: RoomContentPreviewProps) {
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
  const workbench = variant === 'workbench'
  const frame = (title: string, children: ReactNode, actions?: ReactNode, footer?: ReactNode) => <section className="rooms-content-preview ds-code-sidebar rooms-saved-file-preview">
    <div className="ds-code-sidebar-topbar">
      <div className="rooms-saved-file-title" title={title}>
        <span className="ds-code-sidebar-file-badge">{title.split('.').at(-1)?.slice(0, 5).toUpperCase() || 'FILE'}</span>
        <h3>{title}</h3>
      </div>
      <div className="ds-code-sidebar-actions">
        {onFiles ? <button type="button" className="ds-code-sidebar-icon-button" title={t('rightPanelFiles')} aria-label={t('rightPanelFiles')} onClick={onFiles}><Files size={16} strokeWidth={1.75} /></button> : null}
        {actions}
      </div>
    </div>
    {children}
    {footer}
  </section>
  if (loading) {
    const content = <p className="rooms-content-loading" role="status">{t('roomsLoading')}</p>
    return workbench ? frame(reference.titleSnapshot ?? t('filePreviewTitle'), content) : content
  }
  if (error || result?.state !== 'available') {
    const content = <div className="rooms-content-unavailable" role="status">
    <h3>{reference.titleSnapshot ?? t('roomsContentUnavailable')}</h3><p>{t('roomsContentUnavailable')}</p>
    <button type="button" onClick={() => setRetry((value) => value + 1)}>{t('roomsContentRetry')}</button>
    </div>
    return workbench ? frame(reference.titleSnapshot ?? t('filePreviewTitle'), content) : <section className="rooms-content-preview">{content}</section>
  }
  const target = result.openTarget
  const canOpen = target && (onOpenTarget || target.kind === 'thread' && onOpenCode)
  const source = result.sourceTarget
  const scopedSource = room.conversationKind === 'user_agent' && source?.roomId === room.id &&
    source.participantAgentId === room.members[0]?.participantAgentId ? source : undefined
  const preview = result.preview?.type === 'text' ? <div className="rooms-content-document">
      {reference.kind === 'repository_file' && /\.mdx?$/.test(reference.relativePath)
        ? <AssistantMarkdown text={result.preview.text} streaming={false} />
        : <pre>{result.preview.text}</pre>}
      {result.preview.truncated ? <p>{t('roomsContentTruncated')}</p> : null}
    </div> : result.preview?.type === 'image' ? <button type="button" className="rooms-content-image-preview" onClick={() => setExpanded(scope)}>
      <img src={`data:${result.preview.image.mimeType};base64,${result.preview.image.dataBase64}`} alt={result.title} />
      <span><Image size={14} /> {t('roomsContentExpandImage')}</span>
    </button> : <p>{t('roomsContentNoInlinePreview')}</p>
  const sourceLabel = t('roomsArtifactOpenSource', { defaultValue: 'View source conversation' })
  const sourceControl = scopedSource && onOpenSource ? <button type="button"
    className={workbench ? 'rooms-artifact-source ds-code-sidebar-icon-button' : 'rooms-artifact-source'}
    title={sourceLabel} aria-label={sourceLabel} onClick={() => navigate(() => onOpenSource(scopedSource))}>
    <ExternalLink size={workbench ? 16 : 14} strokeWidth={1.75} />{workbench ? null : sourceLabel}</button> : null
  const sourceUnavailable = reference.kind === 'agent_file' && reference.artifactId && !scopedSource
    ? <p className="rooms-artifact-source-unavailable">{t('roomsArtifactSourceUnavailable', { defaultValue: 'Source conversation unavailable' })}</p> : null
  const openControl = canOpen ? <button type="button" className="rooms-content-open" onClick={() => navigate(() => onOpenTarget ? onOpenTarget(target) : target.kind === 'thread' ? onOpenCode?.(target.threadId, target.turnId) : undefined)}><ExternalLink size={14} />{t(target.kind === 'board' || target.kind === 'excalidraw_board' ? 'roomsContentOpenBoard' : target.kind === 'work_file' ? 'roomsContentOpenWork' : 'roomsContentOpenCode')}</button> : null
  const errors = navigationError?.scope === scope ? <p role="alert">{navigationError.message}</p> : null
  const lightbox = expanded === scope && result.preview?.type === 'image' ? <RoomImageLightbox title={result.title} image={result.preview.image} onClose={() => setExpanded('')} /> : null
  if (workbench) return frame(result.title, <>
    <div className="rooms-saved-file-controls"><span>{t('roomsArtifactSnapshot', { defaultValue: 'Saved snapshot' })}</span>
      <RoomArtifactVersions room={room} reference={currentReference} onVersion={setSelectedVersion} compact />
    </div>
    <div className="rooms-saved-file-body">{preview}{openControl}{sourceUnavailable}{errors}</div>{lightbox}
  </>, <>{sourceControl}<RoomArtifactExport room={room} reference={currentReference} compact /></>,
  result.description ? <details className="rooms-saved-file-details"><summary>{t('roomsArtifactDetails', { defaultValue: 'File details' })}</summary><p>{result.description}</p></details> : undefined)
  return <section className="rooms-content-preview">
    <header><h3>{result.title}</h3>{result.status ? <span>{t(roomContentStatusKey(result.kind, result.status), { defaultValue: result.status })}</span> : null}</header>
    {result.version ? <p className="rooms-content-version">{t('roomsContentVersion')} · {result.version}</p> : null}
    {result.description ? <p>{result.description}</p> : null}
    {preview}{openControl}{sourceControl}{sourceUnavailable}
    <RoomArtifactVersions room={room} reference={currentReference} onVersion={setSelectedVersion} />
    <RoomArtifactExport room={room} reference={currentReference} />
    {errors}{lightbox}
  </section>
}
