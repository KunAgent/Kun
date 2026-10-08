import type { ReactElement } from 'react'
import { Feather, Shirt, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { KUN_AVATAR_RARITY_LABELS, kunWardrobeProgress, type KunWardrobeDrop } from '@shared/rooms-api'
import { WardrobeBottleIcon } from './RoomWardrobeBottle'
import type { WardrobeSnapshot } from './room-wardrobe'
import './room-wardrobe.css'

/** Collection progress above the dress-up studio, with every unopened bottle ready to pop. */
export function RoomWardrobeProgress({ state, busy = false, onOpen }: {
  state: WardrobeSnapshot; busy?: boolean; onOpen: (drop: KunWardrobeDrop) => void
}): ReactElement | null {
  const { t, i18n } = useTranslation('common')
  const language = i18n.language.startsWith('zh') ? 'zh' : 'en'
  if (!state.wardrobe) return null
  const progress = kunWardrobeProgress(state.wardrobe)
  return <section className="rooms-wardrobe-strip" aria-label={t('roomsWardrobeTitle')} data-pending={progress.pending || undefined}>
    <div className="rooms-wardrobe-stats">
      <span><Shirt size={14} aria-hidden="true" />{t('roomsWardrobeOwned', { owned: progress.ownedItems, total: progress.totalItems })}</span>
      <span><Sparkles size={14} aria-hidden="true" />{t('roomsWardrobeCards', { lit: progress.litCards, total: progress.totalCards })}</span>
      <span><Feather size={14} aria-hidden="true" />{t('roomsWardrobeFeathers', { count: progress.feathers })}</span>
      <span className="rooms-wardrobe-stats-hint">{progress.dailyLeft === 0 ? t('roomsWardrobeDailyFull') : t('roomsWardrobePity', { count: progress.untilPity })}</span>
    </div>
    {state.wardrobe.pending.length ? <div className="rooms-wardrobe-bottles" role="group" aria-label={t('roomsWardrobePending', { count: progress.pending })}>
      {state.wardrobe.pending.map((drop) => <button key={drop.id} type="button" className="rooms-wardrobe-bottle rooms-wardrobe-rarity"
        data-rarity={drop.rarity} disabled={busy} onClick={() => onOpen(drop)} data-wardrobe-drop={drop.id}>
        <WardrobeBottleIcon size={30} />
        <span className="rooms-wardrobe-bottle-text"><strong>{t('roomsWardrobeBottle')}</strong><small>{KUN_AVATAR_RARITY_LABELS[drop.rarity][language]}</small></span>
        <span className="rooms-wardrobe-bottle-open">{t('roomsWardrobeOpen')}</span>
      </button>)}
    </div> : <p className="rooms-wardrobe-howto">{t('roomsWardrobeHowTo')}</p>}
  </section>
}
