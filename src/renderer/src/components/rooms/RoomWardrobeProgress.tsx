import type { ReactElement } from 'react'
import { Feather, Shirt, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { kunWardrobeRules, kunWardrobeProgress, type KunWardrobeDrop } from '@shared/rooms-api'
import { WardrobeBottleIcon } from './RoomWardrobeBottle'
import { useWardrobeOpener } from './RoomWardrobeOpening'
import { wardrobeShelfStatus } from './RoomWardrobeShelf'
import { wardrobeShelf, type WardrobeSnapshot } from './room-wardrobe'
import './room-wardrobe.css'

const percent = (value: number, total: number) => `${Math.min(100, Math.round(total ? value / total * 100 : 0))}%`

/**
 * The strip above the dress-up studio. The shelf leads (bottle, status, ten slots, open buttons);
 * collection numbers sit in the footer. Opening here puts a new item straight onto the look being edited.
 */
export function RoomWardrobeProgress({ state, busy = false, onWear }: {
  state: WardrobeSnapshot; busy?: boolean; onWear: (drop: KunWardrobeDrop) => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const opener = useWardrobeOpener({ onWear })
  const wardrobe = state.wardrobe
  if (!wardrobe) return null
  const progress = kunWardrobeProgress(wardrobe)
  const TEN = kunWardrobeRules(wardrobe).tenPull
  const count = wardrobeShelf(wardrobe).length
  const ready = TEN > 0 && count >= TEN
  const full = Boolean(wardrobe.progress) && count >= kunWardrobeRules(wardrobe).shelfLimit
  const today = wardrobe.progress?.dailyDrops ?? 0
  const disabled = busy || opener.opening
  return <section className="rooms-wardrobe-strip" aria-label={t('roomsWardrobeTitle')} data-ready={ready || undefined} data-full={full || undefined}
    data-pending={progress.pending || undefined} data-wardrobe-shelf={count}>
    <div className="rooms-wardrobe-strip-main">
      <span className="rooms-wardrobe-strip-bottle" data-empty={!count || undefined} aria-hidden="true">
        <WardrobeBottleIcon size={30} state="sealed" />{count ? <b>{count}</b> : null}
      </span>
      <span className="rooms-wardrobe-strip-text"><strong>{t('roomsShelfTitle')}</strong><span>{wardrobeShelfStatus(wardrobe, t)}</span></span>
      <span className="rooms-wardrobe-strip-slots" aria-hidden="true">
        {Array.from({ length: TEN }, (_, index) => <span key={index} data-filled={index < count || undefined}>
          {index < count ? <WardrobeBottleIcon size={18} state="sealed" /> : null}</span>)}
        {count > TEN ? <i>+{count - TEN}</i> : null}
      </span>
      <span className="rooms-wardrobe-strip-actions">
        <button type="button" disabled={disabled || !count} onClick={() => opener.openOne()} data-shelf-open="one">{t('roomsGachaOpenOne')}</button>
        <button type="button" className="rooms-wardrobe-shelf-ten" disabled={disabled || !ready} onClick={opener.openTen} data-shelf-open="ten">
          {t('roomsGachaOpenTen')}<small>{ready ? t('roomsGachaTenPromiseShort') : t('roomsGachaShort', { count: TEN - count })}</small>
        </button>
      </span>
    </div>
    <div className="rooms-wardrobe-strip-foot">
      <span><Shirt size={14} aria-hidden="true" />{t('roomsWardrobeStatItems')}<b>{progress.ownedItems} / {progress.totalItems}</b>
        <i aria-hidden="true"><span style={{ width: percent(progress.ownedItems, progress.totalItems) }} /></i></span>
      <span data-tone="epic"><Sparkles size={14} aria-hidden="true" />{t('roomsWardrobeStatCards')}<b>{progress.litCards} / {progress.totalCards}</b>
        <i aria-hidden="true"><span style={{ width: percent(progress.litCards, progress.totalCards) }} /></i></span>
      <span><Feather size={14} aria-hidden="true" />{t('roomsWardrobeStatFeathers')}<b>{progress.feathers}</b></span>
      <span className="rooms-wardrobe-strip-hint" data-tone={progress.dailyLeft === 0 || full ? 'warm' : undefined}>
        <span>{progress.dailyLeft === 0 ? t('roomsWardrobeDailyFull') : t('roomsWardrobePity', { count: progress.untilPity })}</span>
        <em>{t('roomsWardrobeToday')} {today} / {kunWardrobeRules(wardrobe).dailyCap}</em>
      </span>
    </div>
    {opener.overlay}
  </section>
}
