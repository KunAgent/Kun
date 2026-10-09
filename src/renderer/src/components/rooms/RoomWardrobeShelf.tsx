import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { KUN_WARDROBE_RULES, kunWardrobeLocalDate, type KunWardrobe } from '@shared/rooms-api'
import { WardrobeBottleIcon } from './RoomWardrobeBottle'
import { wardrobeShelf } from './room-wardrobe'
import './room-wardrobe.css'

const TEN = KUN_WARDROBE_RULES.tenPull

/** What the shelf says about itself: empty, saving up, ready for a ten-pull, or full. */
export function wardrobeShelfStatus(wardrobe: KunWardrobe, t: (key: string, values?: Record<string, unknown>) => string): string {
  const count = wardrobe.pending.length
  if (count >= KUN_WARDROBE_RULES.shelfLimit) return t('roomsShelfFull')
  if (count >= TEN * 2) return t('roomsShelfReadyMany', { count, times: Math.floor(count / TEN) })
  if (count >= TEN) return t('roomsShelfReady', { count })
  if (count > 0) return t('roomsShelfSaving', { count, need: TEN - count })
  const today = wardrobe.daily.date === kunWardrobeLocalDate(new Date()) ? wardrobe.daily.drops : 0
  return t(today ? 'roomsShelfEmpty' : 'roomsShelfEmptyFirst')
}

/** Unopened bottles waiting on a ten-slot shelf, with "open one" and the ten-pull. */
export function RoomWardrobeShelf({ wardrobe, busy = false, onOpenOne, onOpenTen }: {
  wardrobe: KunWardrobe; busy?: boolean; onOpenOne: () => void; onOpenTen: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const count = wardrobeShelf(wardrobe).length
  const ready = count >= TEN
  return <section className="rooms-wardrobe-shelf" data-ready={ready || undefined}
    data-wardrobe-shelf={count} aria-label={t('roomsShelfTitle')}>
    <div className="rooms-wardrobe-shelf-head">
      <strong>{t('roomsShelfTitle')}</strong>
      <span>{wardrobeShelfStatus(wardrobe, t)}</span>
    </div>
    <div className="rooms-wardrobe-shelf-slots" aria-hidden="true">
      {Array.from({ length: TEN }, (_, index) => <span key={index} data-filled={index < count || undefined}>
        {index < count ? <WardrobeBottleIcon size={22} state="sealed" /> : null}</span>)}
    </div>
    <div className="rooms-wardrobe-shelf-actions">
      <button type="button" disabled={busy || !count} onClick={onOpenOne} data-shelf-open="one">{t('roomsGachaOpenOne')}</button>
      <button type="button" className="rooms-wardrobe-shelf-ten" disabled={busy || !ready} onClick={onOpenTen} data-shelf-open="ten">
        {t('roomsGachaOpenTen')}<small>{ready ? t('roomsGachaTenPromiseShort') : t('roomsGachaShort', { count: TEN - count })}</small>
      </button>
    </div>
  </section>
}
