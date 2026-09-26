import { useEffect, useRef, useState } from 'react'
import { File, FolderGit2, Image, KanbanSquare, PackageCheck, ListTodo, ArrowUpRight, Music, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Room, RoomContentReference, RoomPreviewImage } from '@shared/rooms-api'
import { useRoomContent, useRoomContentVisibility, roomContentPath, roomContentStatusKey } from './room-content-client'
import { roomsRequest } from './rooms-client'
import { RoomImageLightbox } from './RoomImageLightbox'
import { useRoomExcalidrawStore } from './room-excalidraw-store'
import './rooms-content.css'

const icons = { agent_file: File, attachment: File, repository_file: FolderGit2, task: ListTodo, delivery: PackageCheck, board_card: KanbanSquare }
export function RoomContentCard({ room, reference, messageId, onOpen }: {
  room: Room
  reference: RoomContentReference
  messageId?: string
  onOpen?: (reference: RoomContentReference, messageId?: string) => void
}) {
  const { t } = useTranslation('common')
  const { ref, visible } = useRoomContentVisibility()
  const { result, error } = useRoomContent(room, reference, 'summary', visible, messageId)
  const thumbnail = useRoomContent(room, reference, 'thumbnail', visible && result?.kind === 'image' && result.state === 'available', messageId)
  const media = useRoomContent(room, reference, 'preview', visible && (result?.kind === 'audio' || result?.kind === 'video') && result.state === 'available', messageId)
  const mediaSource = media.result?.preview?.type === 'media'
    ? `data:${media.result.preview.mimeType};base64,${media.result.preview.dataBase64}` : ''
  const [fullImage, setFullImage] = useState<RoomPreviewImage | null>(null), [opening, setOpening] = useState(false), [openError, setOpenError] = useState('')
  const request = useRef<AbortController | null>(null)
  const previewPath = roomContentPath(room.id, reference, 'preview', messageId)
  useEffect(() => {
    setFullImage(null); setOpening(false); setOpenError('')
    return () => request.current?.abort()
  }, [previewPath])
  const Icon = result?.kind === 'image' ? Image : result?.kind === 'audio' ? Music : result?.kind === 'video' ? Video : icons[reference.kind]
  const unavailable = Boolean(error || result?.state === 'unavailable')
  const title = result?.title ?? reference.titleSnapshot ?? t(`roomsContent_${reference.kind}`)
  const openBoardTarget = result?.openTarget?.kind === 'excalidraw_board' ? result.openTarget : null
  const open = async () => {
    if (unavailable || opening) return
    if (result?.kind !== 'image') { onOpen?.(reference, messageId); return }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setOpening(true); setOpenError('')
    try {
      const preview = await roomsRequest<import('@shared/rooms-api').RoomContentResult>(previewPath, 'GET', undefined, controller.signal)
      if (controller.signal.aborted) return
      if (preview.state !== 'available' || preview.preview?.type !== 'image') throw new Error(t('roomsContentUnavailable'))
      setFullImage(preview.preview.image)
    } catch (cause) { if (!controller.signal.aborted) setOpenError(String(cause)) }
    finally { if (!controller.signal.aborted) setOpening(false) }
  }
  const image = thumbnail.result?.thumbnail
  return <div ref={ref} className={`rooms-content-card${result?.kind === 'image' ? ' is-image' : ''}`}>
    {result?.kind === 'audio' && mediaSource ? <audio controls preload="metadata" src={mediaSource} className="rooms-content-media-audio" /> : null}
    {result?.kind === 'video' && mediaSource ? <video controls preload="metadata" src={mediaSource} className="rooms-content-media-video" /> : null}
    <button type="button" onClick={() => void open()} disabled={opening || unavailable} aria-label={title}>
      {result?.kind === 'image' ? <div className="rooms-content-thumbnail">
        {image ? <img loading="lazy" decoding="async" src={`data:${image.mimeType};base64,${image.dataBase64}`} width={image.width} height={image.height} alt={title} /> : <Image size={28} />}
      </div> : null}
      <div className="rooms-content-card-label"><Icon size={17} /><span><strong>{title}</strong>
        <small>{unavailable ? t('roomsContentUnavailable') : result?.status ? t(roomContentStatusKey(result.kind, result.status), { defaultValue: result.status })
          : result?.byteSize !== undefined ? `${Math.ceil(result.byteSize / 1024)} KB` : t(`roomsContent_${reference.kind}`)}</small></span>
        <ArrowUpRight size={14} /></div>
    </button>
    {openError ? <p role="alert">{openError}</p> : null}
    {openBoardTarget ? <button type="button" className="rooms-content-open-board"
      onClick={() => {
        useRoomExcalidrawStore.getState().registerBoard({ roomId: room.id, boardId: openBoardTarget.boardId,
          workspaceRoot: openBoardTarget.workspaceRoot })
        useRoomExcalidrawStore.getState().openBoard(room.id, openBoardTarget.boardId)
      }}>{t('roomsContentOpenBoard')}</button> : null}
    {fullImage ? <RoomImageLightbox title={title} image={fullImage} onClose={() => setFullImage(null)} /> : null}
  </div>
}
