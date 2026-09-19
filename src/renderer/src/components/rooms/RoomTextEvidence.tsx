import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { roomsRequest } from './rooms-client'
import { useRoomResource } from './useRoomResource'
import { roomButtonClass } from './RoomSettings'
import { arrayBufferToBase64 } from '../../lib/image-attachment-upload'
type TextPage = { text: string; bytes: number; nextCursor?: number; truncated?: boolean; missing?: boolean; reason?: string }
export function RoomTextEvidence({ roomId, path, label, fileName = 'verification.log' }: {
  roomId: string; path: string; label: string; fileName?: string
}) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const resource = useRoomResource<TextPage>(roomId, open ? path : null, false)
  const [text, setText] = useState('')
  const [cursor, setCursor] = useState<number | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setText(''); setCursor(undefined); setError('') }, [path])
  useEffect(() => {
    if (resource.data) { setText(resource.data.text); setCursor(resource.data.nextCursor) }
  }, [resource.data])
  const read = (cursor?: number) => roomsRequest<TextPage>(path + (cursor === undefined ? '' : (path.includes('?') ? '&' : '?') + 'cursor=' + cursor))
  const more = async () => {
    if (cursor === undefined || busy) return
    setBusy(true)
    try { const page = await read(cursor); setText((value) => value + page.text); setCursor(page.nextCursor) }
    catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  const download = async () => {
    if (busy) return
    setBusy(true)
    try {
      const parts: string[] = []
      let cursor: number | undefined
      do {
        const page = await read(cursor)
        parts.push(page.text)
        cursor = page.nextCursor
      } while (cursor !== undefined)
      const blob = new Blob(parts, { type: 'text/plain;charset=utf-8' })
      const result = await window.kunGui.saveWorkspaceFileAs({ suggestedName: fileName.slice(0, 240),
        mimeType: 'text/plain', dataBase64: arrayBufferToBase64(await blob.arrayBuffer()) })
      if (!result.ok && !result.canceled) throw new Error(result.message)
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  return <details className="text-xs text-ds-muted" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer">{label}</summary>
    {open ? <div className="mt-2 space-y-2">
      {resource.data?.reason ? <p>{resource.data.reason}</p> : null}
      {resource.data?.truncated ? <p className="text-amber-600">{t('roomsOutputTruncated')}</p> : null}
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words">{text || (resource.data ? t('roomsEmptyOutput') : t('roomsLoading'))}</pre>
      {cursor !== undefined ? <button className={roomButtonClass} disabled={busy} onClick={() => void more()}>{t('roomsLoadMore')}</button> : null}
      {!resource.data?.missing ? <button className={roomButtonClass} disabled={busy || !resource.data?.bytes} onClick={() => void download()}>{t('roomsDownloadLog')}</button> : null}
      {error || resource.error ? <p role="alert" className="text-red-500">{error || resource.error}</p> : null}
    </div> : null}
  </details>
}
