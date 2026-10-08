import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { KUN_WARDROBE_RULES, kunWardrobeLocalDate } from '@shared/rooms-api'
import { WardrobeBottleIcon } from './RoomWardrobeBottle'
import { useWardrobeOpener } from './RoomWardrobeOpening'
import { RoomUserAvatarEditor } from './RoomUserAvatarEditor'
import { wearDropOnMe } from './room-wardrobe-wear'
import { pendingWardrobeDrops, stashWardrobeDrops, useWardrobe, wardrobeSettings, type WardrobeDropScope } from './room-wardrobe'
import './room-wardrobe.css'

const TEN = KUN_WARDROBE_RULES.tenPull

/**
 * A bottle washed up under the reply of an Agent conversation (roomId) or a
 * Code task (threadId). Its rarity stays hidden; it goes on the shelf unless
 * opened right away.
 */
export function RoomWardrobeDropCard(scope: WardrobeDropScope): ReactElement | null {
  const { t } = useTranslation('common')
  const state = useWardrobe()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [dressing, setDressing] = useState(false)
  const opener = useWardrobeOpener({ onWear: wearDropOnMe, onDress: () => setDressing(true) })
  const pending = pendingWardrobeDrops(state.wardrobe, scope)
  const shown = pending[0]
  // "Quiet" keeps the conversation clean; the rail icon and sidebar still count the bottles.
  const quiet = wardrobeSettings(state.wardrobe).notice === 'quiet'
  if ((!shown || quiet) && !opener.overlay && !dressing) return null
  const shelf = state.wardrobe?.pending.length ?? 0
  const daily = state.wardrobe?.daily
  const firstToday = Boolean(shown && daily && daily.drops === 1 && daily.date === kunWardrobeLocalDate(new Date()) &&
    kunWardrobeLocalDate(new Date(shown.createdAt)) === daily.date)
  const stash = async () => {
    setBusy(true); setError('')
    try { await stashWardrobeDrops(pending.map((drop) => drop.id)) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <div className="rooms-wardrobe-drop-slot" data-wardrobe-pending={pending.length}>
    {shown && !quiet ? <div className="rooms-wardrobe-drop" role="status" data-wardrobe-drop={shown.id}>
      <WardrobeBottleIcon size={40} state="sealed" />
      <div className="rooms-wardrobe-drop-text">
        <strong>{t(shown.source === 'code' ? 'roomsWardrobeFoundCode' : 'roomsWardrobeFound')}</strong>
        <span>{firstToday ? t('roomsWardrobeFirstToday') + ' · ' : ''}{shelf >= TEN
          ? t('roomsShelfReady', { count: shelf }) : t('roomsShelfSaving', { count: shelf, need: TEN - shelf })}</span>
        <span className="rooms-wardrobe-drop-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, shelf / TEN * 100)}%` }} /></span>
      </div>
      <div className="rooms-wardrobe-drop-actions">
        <button type="button" disabled={busy} onClick={() => void stash()} data-drop-stash>{t('roomsShelfStash')}</button>
        <button type="button" className="rooms-run-primary" disabled={busy || opener.opening} onClick={() => opener.openOne(shown.id)}
          data-drop-open>{t('roomsShelfOpenNow')}</button>
      </div>
    </div> : null}
    {error ? <p role="alert" className="rooms-run-error">{error}</p> : null}
    {opener.overlay}
    {dressing ? <RoomUserAvatarEditor onClose={() => setDressing(false)} /> : null}
  </div>
}
