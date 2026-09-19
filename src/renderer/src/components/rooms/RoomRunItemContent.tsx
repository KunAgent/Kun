import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomRunContentPage, RoomRunItemsPage } from '@shared/rooms-api'
import { roomPath, roomsRequest } from './rooms-client'
import { RoomMessageBody } from './RoomMessageBody'

export function RoomRunItemContent({
  roomId,
  runId,
  itemId,
  preview,
  code = false
}: {
  roomId: string
  runId: string
  itemId: string
  preview: string
  code?: boolean
}) {
  const { t } = useTranslation('common')
  const [page, setPage] = useState<RoomRunContentPage | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => { request.current?.abort(); setPage(null); setText(''); setBusy(false); setError('') }, [preview])
  useEffect(() => () => request.current?.abort(), [])
  const load = async (offset = 0) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const result = await roomsRequest<RoomRunItemsPage>(
        `${roomPath(roomId)}/runs/${encodeURIComponent(runId)}/items?item_id=${encodeURIComponent(itemId)}&content_offset=${offset}`,
        'GET',
        undefined,
        controller.signal
      )
      if (controller.signal.aborted) return
      if (!result.content) throw new Error(t('roomsRunContentUnavailable'))
      setText((current) =>
        offset ? current + result.content!.text : result.content!.text
      )
      setPage(result.content)
    } catch (cause) {
      if (!controller.signal.aborted) setError(String(cause))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const body = page ? text : preview
  return (
    <div className="rooms-run-content">
      {code ? (
        <pre>{body}</pre>
      ) : (
        <RoomMessageBody body={body} attachmentIds={[]} />
      )}
      {page ? (
        <p className="rooms-run-note">
          {t('roomsRunContentRange', {
            loaded: text.length,
            total: page.totalChars
          })}
        </p>
      ) : null}
      {!page || page.nextOffset !== undefined ? (
        <button
          type="button"
          className="rooms-run-secondary"
          disabled={busy}
          onClick={() => void load(page?.nextOffset)}
        >
          {t(
            busy
              ? 'roomsLoading'
              : page
                ? 'roomsLoadMore'
                : 'roomsRunFullContent'
          )}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="rooms-run-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
