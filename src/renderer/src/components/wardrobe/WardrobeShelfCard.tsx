import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { KUN_WARDROBE_RULES, kunWardrobeLocalDate, kunWardrobeProgress, type KunWardrobe } from '@shared/rooms-api'
import { WardrobeBottleIcon } from '../rooms/RoomWardrobeBottle'
import { wardrobeShelfStatus } from '../rooms/RoomWardrobeShelf'
import { wardrobeSettings, wardrobeShelf } from '../rooms/room-wardrobe'

const TEN = KUN_WARDROBE_RULES.tenPull

/** Unopened bottles standing on two planks of five, today's drops, and the two ways to open them. */
export function WardrobeShelfCard({ wardrobe, busy, onOpenOne, onOpenTen }: {
  wardrobe: KunWardrobe; busy: boolean; onOpenOne: () => void; onOpenTen: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const count = wardrobeShelf(wardrobe).length
  const ready = count >= TEN
  const progress = kunWardrobeProgress(wardrobe)
  const settings = wardrobeSettings(wardrobe)
  const cap = KUN_WARDROBE_RULES.dailyCap
  const today = wardrobe.daily.date === kunWardrobeLocalDate(new Date()) ? wardrobe.daily.drops : 0
  const next = !settings.drops ? t('roomsWardrobeDropsOff') : today >= cap ? t('roomsWardrobeDailyFull')
    : today > 0 ? t('roomsWardrobeFirstDone', { count: progress.untilPity }) : t('roomsWardrobeFirstPending')
  return <section className="kun-wardrobe-shelf" data-ready={ready || undefined} data-wardrobe-shelf={count} aria-label={t('roomsShelfTitle')}>
    <div className="kun-wardrobe-shelf-head">
      <WardrobeBottleIcon size={34} state="sealed" />
      <span className="kun-wardrobe-shelf-title">
        <span><strong>{t('roomsShelfTitle')}</strong><b>{count}</b></span>
        <small>{wardrobeShelfStatus(wardrobe, t)}</small>
      </span>
      <span className="kun-wardrobe-today" title={t('roomsWardrobeTodayCount', { count: today, cap })}>
        {t('roomsWardrobeToday')} {today} / {cap}
        <span aria-hidden="true">{Array.from({ length: cap }, (_, index) => <i key={index} data-on={index < today || undefined} />)}</span>
      </span>
    </div>
    <div className="kun-wardrobe-planks" aria-hidden="true">
      {[0, 1].map((row) => <div key={row} className="kun-wardrobe-plank">
        {Array.from({ length: 5 }, (_, cell) => {
          const index = row * 5 + cell
          return <span key={cell} data-filled={index < count || undefined} style={{ animationDelay: `${index * 160}ms` }}>
            <WardrobeBottleIcon size={30} state="sealed" />
          </span>
        })}
      </div>)}
    </div>
    <div className="kun-wardrobe-shelf-actions">
      <button type="button" disabled={busy || !count} onClick={onOpenOne} data-shelf-open="one">{t('roomsGachaOpenOne')}</button>
      <button type="button" className="kun-wardrobe-ten" disabled={busy || !ready} onClick={onOpenTen} data-shelf-open="ten">
        {t('roomsGachaOpenTen')}<small>{ready ? t('roomsGachaTenPromiseShort') : t('roomsGachaShort', { count: TEN - count })}</small>
      </button>
    </div>
    <p className="kun-wardrobe-shelf-next">{next}</p>
  </section>
}
