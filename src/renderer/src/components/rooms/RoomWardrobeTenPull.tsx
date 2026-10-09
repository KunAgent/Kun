import type { CSSProperties, ReactElement } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { KUN_AVATAR_RARITIES, KUN_WARDROBE_RULES, type KunAvatarRarity, type KunWardrobeDrop } from '@shared/rooms-api'
import { WardrobeBottleGlow, WardrobeBottleIcon } from './RoomWardrobeBottle'
import { WardrobeResultCard, wardrobeDropDetails } from './RoomWardrobeResultCard'

type Language = 'zh' | 'en'
const rank = (rarity: KunAvatarRarity) => KUN_AVATAR_RARITIES.indexOf(rarity)

/**
 * "Flip all" order: common first, rarest last. The last card waits a little longer when it is
 * epic or better, and a legendary last card gets the gold flash.
 */
export function wardrobeFlipOrder(drops: readonly KunWardrobeDrop[], open: ReadonlySet<number>): Array<{ index: number; at: number; flash: boolean }> {
  const order = drops.map((drop, index) => ({ index, level: rank(drop.rarity) })).filter((entry) => !open.has(entry.index))
    .sort((a, b) => a.level - b.level || a.index - b.index)
  let at = 0
  return order.map((entry, step) => {
    const last = step === order.length - 1 && entry.level >= 2
    at += last ? 700 : 220
    return { index: entry.index, at, flash: last && entry.level === 3 }
  })
}

/** Ten bottles, then ten cards dealt face down; glowing backs are rare or better. */
export function WardrobeTenGrid({ drops, phase, lit, open, language, onCard }: {
  drops: readonly KunWardrobeDrop[]; phase: string; lit: boolean; open: ReadonlySet<number>; language: Language
  onCard: (index: number) => void
}): ReactElement {
  const dealt = phase === 'reveal' || phase === 'table' || phase === 'done'
  const waiting = phase === 'table' || phase === 'done'
  const slots = drops.length ? drops : Array.from({ length: KUN_WARDROBE_RULES.tenPull }, () => undefined)
  return <div className="kun-gacha-grid">
    {slots.map((drop, index) => {
      const faceUp = open.has(index)
      return <div key={drop?.id ?? index} className="kun-gacha-slot rooms-wardrobe-rarity"
        data-rarity={lit && drop && (faceUp || !dealt) ? drop.rarity : undefined} style={{ '--i': index } as CSSProperties}>
        {dealt && drop ? <>
          {faceUp && rank(drop.rarity) >= 2 ? <span className="kun-gacha-slot-rays" aria-hidden="true" /> : null}
          <div className="kun-gacha-deal" data-dealing={phase === 'reveal' || undefined}>
            <WardrobeResultCard drop={drop} size="small" faceUp={faceUp} hint={waiting && !faceUp && rank(drop.rarity) >= 1}
              index={index} language={language} onClick={waiting ? () => onCard(index) : undefined} />
          </div>
        </> : <span className="kun-gacha-slot-bottle" data-state={phase}>
          {phase === 'charge' || phase === 'burst' ? <WardrobeBottleGlow className="kun-gacha-bottle-glow" /> : null}
          <WardrobeBottleIcon size={104} state="sealed" />
        </span>}
      </div>
    })}
  </div>
}

/** One flipped card up close, with the others a click or an arrow key away. */
export function WardrobeCardViewer({ drops, open, index, language, onMove, onClose }: {
  drops: readonly KunWardrobeDrop[]; open: ReadonlySet<number>; index: number; language: Language
  onMove: (index: number) => void; onClose: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const drop = drops[index]
  if (!drop) return null
  const shown = [...open].sort((a, b) => a - b)
  const at = Math.max(0, shown.indexOf(index))
  const step = (delta: number) => onMove(shown[(at + delta + shown.length) % shown.length]!)
  const { name, flavor } = wardrobeDropDetails(drop, language)
  return <div className="kun-gacha-viewer rooms-wardrobe-rarity" data-rarity={drop.rarity} role="group" aria-label={name} data-gacha-viewer
    onKeyDown={(event) => { if (event.key === 'ArrowLeft') step(-1); else if (event.key === 'ArrowRight') step(1) }}>
    <button type="button" className="kun-gacha-viewer-scrim" aria-label={t('roomsClose')} onClick={onClose} tabIndex={-1} />
    <span className="kun-gacha-viewer-dots" aria-hidden="true">{shown.map((item) =>
      <span key={item} data-on={item === index || undefined} data-rarity={drops[item]!.rarity} />)}</span>
    <div className="kun-gacha-viewer-card"><WardrobeResultCard key={drop.id} drop={drop} size="large" sway language={language} /></div>
    {shown.length > 1 ? <>
      <button type="button" className="kun-gacha-viewer-step" data-side="prev" aria-label={t('roomsGachaPrev')} onClick={() => step(-1)}><ChevronLeft size={22} /></button>
      <button type="button" className="kun-gacha-viewer-step" data-side="next" aria-label={t('roomsGachaNext')} onClick={() => step(1)}><ChevronRight size={22} /></button>
    </> : null}
    <p className="kun-gacha-viewer-note">{drop.duplicate ? t('roomsGachaDuplicateHint') : drop.kind === 'card' ? t('roomsGachaCardHint') : flavor || t('roomsGachaTiltHint')}</p>
    <button type="button" className="kun-gacha-viewer-close" aria-label={t('roomsClose')} onClick={onClose} data-gacha-viewer-close><X size={18} /></button>
  </div>
}
