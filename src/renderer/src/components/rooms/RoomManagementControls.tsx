import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RoomPreferenceDetail, RoomRepositoryChoice } from '@shared/rooms-api'
import { roomNotificationsMuted } from '../../../../../kun/src/contracts/room-experience'
import { RoomPopover } from './RoomPopover'
import { roomPath, roomRequestId, roomsRequest } from './rooms-client'
import { subscribeRoomEvents } from './useRoomEvents'
import { useRoomPresentationPreferences } from './room-presentation-preferences'
import './rooms-experience.css'

export function RoomListFilters({ filter, archived, repositoryRoot, onFilter, onRepository }: {
  filter: 'all' | 'unread' | 'attention'; archived: boolean; repositoryRoot: string
  onFilter: (value: 'all' | 'unread' | 'attention' | 'archived') => void
  onRepository: (value: string) => void
}) {
  const { t } = useTranslation('common')
  const [repositories, setRepositories] = useState<RoomRepositoryChoice[]>([])
  useEffect(() => {
    const controller = new AbortController()
    void roomsRequest<{ repositories: RoomRepositoryChoice[] }>('/v1/rooms/repositories', 'GET', undefined, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setRepositories(result.repositories) }).catch(() => undefined)
    return () => controller.abort()
  }, [])
  return <div className="rooms-list-filters">
    <select aria-label={t('roomsFilter')} value={archived ? 'archived' : filter}
      onChange={(event) => onFilter(event.target.value as Parameters<typeof onFilter>[0])}>
      {(['all', 'unread', 'attention', 'archived'] as const).map((value) => <option key={value} value={value}>{t('roomsFilter_' + value)}</option>)}
    </select>
    <select aria-label={t('roomsRepositoryFilter')} value={repositoryRoot} onChange={(event) => onRepository(event.target.value)}>
      <option value="">{t('roomsAllRepositories')}</option>
      {repositories.map((repo) => <option key={repo.canonicalRoot} value={repo.canonicalRoot}>{repo.displayName}</option>)}
    </select>
  </div>
}

export function RoomAppearanceMenu() {
  const { t } = useTranslation('common')
  const preferences = useRoomPresentationPreferences()
  return <RoomPopover label={t('roomsAppearance')} trigger={<SlidersHorizontal size={16} />} align="end" className="rooms-icon-button" width={256}>
    {() => <div className="rooms-appearance-menu">
      <label className="rooms-appearance-check"><input type="checkbox" checked={preferences.autoLinkPreviews}
        onChange={(event) => preferences.setPreference({ autoLinkPreviews: event.target.checked })} />{t('roomsAutomaticLinkPreviews')}</label>
      <button type="button" onClick={() => window.dispatchEvent(new Event('kun-room-user-avatar'))}>{t('roomsMyAvatar')}</button>
      <button type="button" onClick={() => preferences.setPreference({ listWidth: 300, detailWidth: 400 })}>{t('roomsResetWidths')}</button>
    </div>}
  </RoomPopover>
}

export function RoomNotificationMenu({ roomId }: { roomId: string }) {
  const { t } = useTranslation('common')
  const [detail, setDetail] = useState<RoomPreferenceDetail | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [time, setTime] = useState(Date.now())
  const current = useRef(roomId); current.current = roomId
  useEffect(() => {
    const controller = new AbortController()
    setDetail(null); setError(''); setBusy(false)
    const refresh = () => roomsRequest<RoomPreferenceDetail>(roomPath(roomId) + '/preferences', 'GET', undefined, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setDetail((old) => old && (old.revision ?? -1) > (value.revision ?? -1) ? old : value) }).catch((cause) => { if (!controller.signal.aborted) setError(String(cause)) })
    void refresh()
    const off = subscribeRoomEvents((event) => { if (event.roomId === roomId && event.kind === 'presentation.preference.updated') void refresh() })
    const timer = setInterval(() => setTime(Date.now()), 30000)
    return () => { controller.abort(); off(); clearInterval(timer) }
  }, [roomId])
  const muted = detail && roomNotificationsMuted(detail.preference, time)
  const update = async (duration: number | 'forever' | 'off') => {
    if (!detail || busy) return
    setBusy(true); setError('')
    try {
      const value = await roomsRequest<RoomPreferenceDetail>(roomPath(roomId) + '/preferences', 'PUT', {
        clientRequestId: roomRequestId(), expectedRevision: detail.revision,
        mode: duration === 'off' ? 'all' : duration === 'forever' ? 'muted' : 'until',
        mutedUntil: typeof duration === 'number' ? new Date(Date.now() + duration).toISOString() : undefined
      })
      if (current.current === roomId) { setDetail((old) => old && (old.revision ?? -1) > (value.revision ?? -1) ? old : value); setTime(Date.now()) }
    } catch (cause) { if (current.current === roomId) setError(String(cause)) }
    finally { if (current.current === roomId) setBusy(false) }
  }
  return <RoomPopover label={t(muted ? 'roomsNotificationsMuted' : 'roomsNotificationSettings')}
    trigger={muted ? <BellOff size={17} /> : <Bell size={17} />} align="end" className="rooms-icon-button" width={248}>
    {() => <div className="rooms-menu-list">
      <p className="rooms-run-note">{t('roomsMuteBoundary')}</p>
      {muted ? <button type="button" disabled={busy} onClick={() => void update('off')}>{t('roomsUnmuteNotifications')}</button> : null}
      <button type="button" disabled={!detail || busy} onClick={() => void update(3600000)}>{t('roomsMuteHour')}</button>
      <button type="button" disabled={!detail || busy} onClick={() => void update(86400000)}>{t('roomsMuteDay')}</button>
      <button type="button" disabled={!detail || busy} onClick={() => void update('forever')}>{t('roomsMuteForever')}</button>
      {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
    </div>}
  </RoomPopover>
}
