import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomAgreementContext } from '@shared/rooms-api'
import { roomsRequest, roomPath } from './rooms-client'
import { useRoomPage } from './useRoomPage'
import { useRoomResource } from './useRoomResource'
import { roomButtonClass } from './RoomSettings'
function OriginalRule({ roomId, path, label }: { roomId: string; path: string; label: string }) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const data = useRoomResource<{ rule: { body: string }; nextOffset?: number }>(roomId, open ? path : null, false)
  const [text, setText] = useState('')
  const [offset, setOffset] = useState<number | undefined>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data.data) { setText(data.data.rule.body); setOffset(data.data.nextOffset) } }, [data.data])
  const more = async () => {
    if (offset === undefined || busy) return
    setBusy(true)
    try {
      const page = await roomsRequest<{ rule: { body: string }; nextOffset?: number }>(path + '&offset=' + offset)
      setText((old) => old + page.rule.body); setOffset(page.nextOffset)
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{label}</summary>
    <p className="whitespace-pre-wrap break-words">{text}</p>
    {offset !== undefined ? <button className={roomButtonClass} disabled={busy} onClick={() => void more()}>{t('roomsLoadMore')}</button> : null}
    {error || data.error ? <p role="alert" className="text-red-500">{error || data.error}</p> : null}
  </details>
}
export function RoomAgreementSources({ roomId, agreements }: { roomId: string; agreements?: RoomAgreementContext }) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const path = agreements ? roomPath(roomId) + '/agreements/' + agreements.bundleId : ''
  const page = useRoomPage<{ id: string; version: number }>(roomId, open && agreements ? path : null, 'references')
  if (!agreements?.count) return null
  return <section className="space-y-2 rounded border border-ds-border p-2 text-xs text-ds-muted">
    <p>{t(agreements.compressed ? 'roomsAgreementsCompressed' : 'roomsAgreementsOriginal')} · {agreements.count}</p>
    {agreements.compressed ? <><p>{t('roomsCompressionHint')}</p><p className="max-h-44 overflow-auto whitespace-pre-wrap break-words">{agreements.summary}</p></> : null}
    <button className={roomButtonClass} aria-expanded={open} onClick={() => setOpen(!open)}>{t('roomsViewOriginalRules')}</button>
    {open ? <div className="max-h-60 space-y-2 overflow-auto">
      {page.items.map((ref) => <OriginalRule key={ref.id + ':' + ref.version} roomId={roomId}
        path={path + '?rule_id=' + encodeURIComponent(ref.id) + '&version=' + ref.version} label={ref.id + ' · v' + ref.version} />)}
      {page.nextCursor ? <button className={roomButtonClass} disabled={page.busy} onClick={() => void page.loadMore()}>{t('roomsLoadMore')}</button> : null}
      {page.error ? <p role="alert" className="text-red-500">{page.error}</p> : null}
    </div> : null}
  </section>
}
