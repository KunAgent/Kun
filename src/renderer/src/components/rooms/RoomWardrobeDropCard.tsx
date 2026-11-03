import { RoomWardrobeGuestDrop } from './RoomWardrobeGuestDrop'
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { kunWardrobeRules } from '@shared/rooms-api'
import { WardrobeBottleIcon } from './RoomWardrobeBottle'
import { useWardrobeOpener } from './RoomWardrobeOpening'
import { RoomUserAvatarEditor } from './RoomUserAvatarEditor'
import { wearDropOnMe } from './room-wardrobe-wear'
import { pendingWardrobeDrops, stashWardrobeDrops, useWardrobe, wardrobeSettings, type WardrobeDropScope } from './room-wardrobe'
import './room-wardrobe.css'


/**
 * A bottle washed up under the reply of an Agent conversation (roomId) or a
 * Code task (threadId). Its rarity stays hidden; it goes on the shelf unless
 * opened right away.
 */
export function RoomWardrobeDropCard(scope: WardrobeDropScope): ReactElement | null {
  const { t } = useTranslation('common')
  const state = useWardrobe()
  const TEN = kunWardrobeRules(state.wardrobe).tenPull
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [dressing, setDressing] = useState(false)
  const opener = useWardrobeOpener({ onWear: wearDropOnMe, onDress: () => setDressing(true) })
  const pending = pendingWardrobeDrops(state.wardrobe, scope)
  const shown = pending[0]
  // "Quiet" keeps the conversation clean; the rail icon and sidebar still count the bottles.
  const quiet = wardrobeSettings(state.wardrobe).notice === 'quiet'
  if (state.mode === 'guest') return quiet ? null : <RoomWardrobeGuestDrop hints={state.guestHints ?? []} scope={scope} />
  if ((!shown || quiet) && !opener.overlay && !dressing) return null
  const shelf = state.wardrobe?.pending.length ?? 0
  const firstToday = shown?.activityReceipt?.reason === 'daily_first' && shown.activityReceipt.resetAt === state.wardrobe?.progress?.resetAt
  const stash = async () => {
    setBusy(true); setError('')
    try { await stashWardrobeDrops(pending.map((drop) => drop.id)) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  return <div className="rooms-wardrobe-drop-slot" data-wardrobe-pending={pending.length}>
    {shown && !quiet ? <div className="rooms-wardrobe-drop" role="status" data-wardrobe-drop={shown.id}>
      <WardrobeBottleIcon size={40} state="sealed" />
      <div className="rooms-wardrobe-drop-text">
        <strong>{t(shown.source === 'code' ? 'roomsWardrobeFoundCode' : 'roomsWardrobeFound')}</strong>
        <span>{firstToday ? t('roomsWardrobeFirstToday') + ' · ' : ''}{TEN > 0 && shelf >= TEN
          ? t('roomsShelfReady', { count: shelf }) : t('roomsShelfSaving', { count: shelf, need: TEN - shelf })}</span>
        <span className="rooms-wardrobe-drop-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, shelf / Math.max(1,TEN) * 100)}%` }} /></span>
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
