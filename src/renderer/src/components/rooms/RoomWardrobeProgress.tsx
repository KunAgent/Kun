import type { ReactElement } from 'react'
import { Feather, Shirt, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { kunWardrobeProgress, type KunWardrobeDrop } from '@shared/rooms-api'
import { useWardrobeOpener } from './RoomWardrobeOpening'
import { RoomWardrobeShelf } from './RoomWardrobeShelf'
import type { WardrobeSnapshot } from './room-wardrobe'
import './room-wardrobe.css'

/**
 * Collection progress above the dress-up studio, with the bottle shelf.
 * Opening here puts a new item straight onto the look being edited.
 */
export function RoomWardrobeProgress({ state, busy = false, onWear }: {
  state: WardrobeSnapshot; busy?: boolean; onWear: (drop: KunWardrobeDrop) => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const opener = useWardrobeOpener({ onWear })
  if (!state.wardrobe) return null
  const progress = kunWardrobeProgress(state.wardrobe)
  return <section className="rooms-wardrobe-strip" aria-label={t('roomsWardrobeTitle')} data-pending={progress.pending || undefined}>
    <div className="rooms-wardrobe-stats">
      <span><Shirt size={14} aria-hidden="true" />{t('roomsWardrobeOwned', { owned: progress.ownedItems, total: progress.totalItems })}</span>
      <span><Sparkles size={14} aria-hidden="true" />{t('roomsWardrobeCards', { lit: progress.litCards, total: progress.totalCards })}</span>
      <span><Feather size={14} aria-hidden="true" />{t('roomsWardrobeFeathers', { count: progress.feathers })}</span>
      <span className="rooms-wardrobe-stats-hint">{progress.dailyLeft === 0 ? t('roomsWardrobeDailyFull') : t('roomsWardrobePity', { count: progress.untilPity })}</span>
    </div>
    <RoomWardrobeShelf wardrobe={state.wardrobe} compact busy={busy || opener.opening} onOpenOne={() => opener.openOne()} onOpenTen={opener.openTen} />
    {opener.overlay}
  </section>
}
