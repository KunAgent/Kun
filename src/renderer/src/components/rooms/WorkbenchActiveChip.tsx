import { useCallback, useEffect, useState } from 'react'
import { Loader2, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WorkbenchLinkEntry } from '@shared/rooms-api'
import { RoomPopover } from './RoomPopover'
import { subscribeRoomEvents } from './useRoomEvents'
import { WORKBENCH_LIVE_STATUSES, workbenchClient } from './workbench-client'
import { openWorkbenchLinkTarget, workbenchOpenTarget } from './workbench-navigation'
import './rooms-workbench.css'

/** "N in progress" pill in a bot conversation header, with the running Code/Work tasks behind it. */
export function WorkbenchActiveChip({ roomId }: { roomId: string }) {
  const { t } = useTranslation('common')
  const [links, setLinks] = useState<WorkbenchLinkEntry[]>([])
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const page = await workbenchClient.list(roomId, WORKBENCH_LIVE_STATUSES, signal)
      if (!signal?.aborted) setLinks(page.links.filter((link) => link.kind !== 'watch'))
    } catch { if (!signal?.aborted) setLinks([]) }
  }, [roomId])
  useEffect(() => {
    setLinks([])
    const controller = new AbortController()
    void refresh(controller.signal)
    const off = subscribeRoomEvents((event) => {
      if (event.roomId === roomId && event.kind === 'workbench.link.updated') void refresh()
    })
    return () => { controller.abort(); off() }
  }, [refresh, roomId])
  if (!links.length) return null
  const attention = links.filter((link) => link.status === 'needs_attention').length
  return <RoomPopover label={t('roomsWorkbenchActive', { count: links.length })} align="end" width={320} className="rooms-workbench-chip"
    trigger={<span className="rooms-workbench-chip-label">
      {attention ? <ShieldAlert size={13} aria-hidden="true" /> : <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
      {t('roomsWorkbenchActive', { count: links.length })}</span>}>
    {(close) => <ul className="rooms-workbench-chip-list">
      {links.map((link) => {
        const target = workbenchOpenTarget(link)
        return <li key={link.id} data-status={link.status}>
          <strong title={link.request.title}>{link.request.title}</strong>
          <span>{t(`roomsWorkbenchStatus_${link.status}`)}</span>
          {target ? <button type="button" onClick={() => { close(); void openWorkbenchLinkTarget(link) }}>
            {t(target === 'code' ? 'roomsWorkbenchOpenCode' : target === 'board' ? 'roomsWorkbenchOpenBoard' : 'roomsWorkbenchOpenWork')}</button> : null}
        </li>
      })}
    </ul>}
  </RoomPopover>
}
