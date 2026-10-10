import type { CSSProperties, ReactElement } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { KUN_AVATAR_RARITIES, KUN_AVATAR_RARITY_LABELS, type KunAvatarParts, type KunAvatarRarity, type KunWardrobe } from '@shared/rooms-api'
import { RoomAvatar } from '../rooms/RoomAvatar'
import { RoomAvatarItemArt } from '../rooms/RoomAvatarItemArt'
import { WardrobeUnknownItem } from '../rooms/RoomWardrobeBottle'
import { composedAvatarLayerUrl } from '../rooms/room-avatar-compositor'
import {
  wardrobeCategoryCounts, wardrobeRoleCards, wardrobeTiles,
  type WardrobeCardFilter, type WardrobeCategory, type WardrobeRoleCard, type WardrobeSelection, type WardrobeTile
} from './wardrobe-page-model'
import { WARDROBE_SLOT_LABELS } from './WardrobeStage'

type Language = 'zh' | 'en'
const CATEGORIES: readonly WardrobeCategory[] = ['all', 'headwear', 'glasses', 'outfit', 'prop']
const Pips = ({ rarity, dim = false }: { rarity: KunAvatarRarity; dim?: boolean }) =>
  <span className="kun-wardrobe-pips" data-dim={dim || undefined} aria-hidden="true">
    {Array.from({ length: KUN_AVATAR_RARITIES.indexOf(rarity) + 1 }, (_, index) => <span key={index} />)}
  </span>

/** Every item: owned ones try on when hovered and go on with a click; unknown ones only say how rare they are. */
export function WardrobeItemsSection({ wardrobe, unlockAll, parts, dressed, language, category, ownedOnly, selection,
  onCategory, onSelect, onWear, onTry, onEndTry }: {
  wardrobe: KunWardrobe; unlockAll: boolean; parts: KunAvatarParts; dressed: boolean; language: Language
  category: WardrobeCategory; ownedOnly: boolean; selection: WardrobeSelection
  onCategory: (category: WardrobeCategory) => void; onSelect: (selection: WardrobeSelection) => void
  onWear: (tile: WardrobeTile, worn: boolean) => void; onTry: (tile: WardrobeTile) => void; onEndTry: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const tiles = wardrobeTiles(wardrobe, unlockAll, category, ownedOnly)
  return <>
    <div className="kun-wardrobe-chips" role="group" aria-label={t('wardrobePageTabItems')}>
      {CATEGORIES.map((id) => {
        const counts = wardrobeCategoryCounts(wardrobe, unlockAll, id)
        return <button key={id} type="button" aria-pressed={category === id} onClick={() => onCategory(id)} data-wardrobe-category={id}>
          {t(id === 'all' ? 'roomsWardrobeAll' : WARDROBE_SLOT_LABELS[id])}<span>{counts.owned}/{counts.total}</span>
        </button>
      })}
    </div>
    <div className="kun-wardrobe-scroll">
      <div className="kun-wardrobe-grid" onPointerLeave={onEndTry}
        onPointerOver={(event) => { if (!(event.target as Element).closest('[data-wardrobe-item]')) onEndTry() }}>
        {tiles.map((tile) => {
          const on = selection?.kind === 'item' && selection.key === tile.key
          const rarity = KUN_AVATAR_RARITY_LABELS[tile.rarity][language]
          if (!tile.owned) {
            // Not found yet: no art, no name, no try-on; only how rare it is.
            return <button key={tile.key} type="button" className="kun-wardrobe-tile rooms-wardrobe-rarity" data-rarity={tile.rarity} data-locked
              aria-pressed={on} data-wardrobe-item="unknown" aria-label={`${t('roomsWardrobeUnknownItem')}，${rarity}`}
              onPointerEnter={onEndTry} onClick={() => onSelect(on ? null : { kind: 'item', key: tile.key })}>
              <span className="kun-wardrobe-tile-well"><WardrobeUnknownItem size={46} /></span>
              <span className="kun-wardrobe-tile-name">{t('roomsWardrobeUnknownItem')}</span>
              <Pips rarity={tile.rarity} dim />
            </button>
          }
          const worn = dressed && parts[tile.category] === tile.id
          return <button key={tile.key} type="button" className="kun-wardrobe-tile rooms-wardrobe-rarity" data-rarity={tile.rarity}
            data-worn={worn || undefined} aria-pressed={on} data-wardrobe-item={tile.key}
            aria-label={`${tile.name[language]}，${rarity}${worn ? `，${t('wardrobePageWorn')}` : ''}`}
            title={`${tile.name[language]} · ${rarity} — ${tile.flavor[language]}`}
            onPointerEnter={worn ? onEndTry : () => onTry(tile)} onClick={() => onWear(tile, worn)}>
            <span className="kun-wardrobe-tile-well"><RoomAvatarItemArt category={tile.category} id={tile.id} size={56} /></span>
            <span className="kun-wardrobe-tile-name">{tile.name[language]}</span>
            <Pips rarity={tile.rarity} />
            {worn ? <span className="kun-wardrobe-tile-worn"><Check size={10} strokeWidth={3.4} aria-hidden="true" />{t('wardrobePageWorn')}</span> : null}
            {tile.fresh ? <span className="kun-wardrobe-tile-new">{t('roomsWardrobeNew')}</span>
              : tile.copies > 1 ? <span className="kun-wardrobe-tile-copies" aria-hidden="true">{t('roomsWardrobeCount', { count: tile.copies })}</span> : null}
          </button>
        })}
      </div>
    </div>
  </>
}

/** A role card in the codex, drawn with the flash-card finish; unrevealed ones show the shared back. */
function WardrobeCodexCard({ card, language }: { card: WardrobeRoleCard; language: Language }): ReactElement {
  const scene = composedAvatarLayerUrl(`scene/${card.preset.cardScene}`, 256)
  const back = composedAvatarLayerUrl('card/back', 256)
  const level = KUN_AVATAR_RARITIES.indexOf(card.rarity) + 1
  return <span className="kun-holo rooms-wardrobe-rarity" data-rarity={card.rarity} data-size="small" data-face-up={card.lit || undefined}>
    <span className="kun-holo-card">
      <span className="kun-holo-face kun-holo-front">
        {card.lit && scene ? <span className="kun-holo-scene" style={{ backgroundImage: `url("${scene}")` }} /> : null}
        <span className="kun-holo-tint" />
        <span className="kun-holo-halo" />
        {card.lit ? <span className="kun-holo-subject"><RoomAvatar avatar={{ kind: 'composed', version: 1, parts: { ...card.preset.parts, bg: 'transparent' } }}
          id={`wardrobe-codex-${card.preset.id}`} label="" size={84} user /></span> : null}
        <span className="kun-holo-frame" />
        <span className="kun-holo-top"><span className="kun-holo-pips">{Array.from({ length: level }, (_, pip) => <span key={pip} />)}</span></span>
        <span className="kun-holo-plate"><strong className="kun-holo-name">{card.lit ? card.preset.label[language] : ''}</strong>
          <span className="kun-holo-sub">{KUN_AVATAR_RARITY_LABELS[card.rarity][language]}</span></span>
        <span className="kun-holo-foil" />
        <span className="kun-holo-lines" />
        <span className="kun-holo-sparkle" />
        <span className="kun-holo-glare" />
      </span>
      <span className="kun-holo-face kun-holo-back">{back ? <img src={back} alt="" draggable={false} decoding="async" /> : null}</span>
    </span>
  </span>
}

export function WardrobeCardsSection({ wardrobe, unlockAll, language, filter, selection, onFilter, onSelect }: {
  wardrobe: KunWardrobe; unlockAll: boolean; language: Language; filter: WardrobeCardFilter; selection: WardrobeSelection
  onFilter: (filter: WardrobeCardFilter) => void; onSelect: (selection: WardrobeSelection) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const all = wardrobeRoleCards(wardrobe, unlockAll)
  const counts: Record<WardrobeCardFilter, number> = { all: all.length, lit: all.filter((card) => card.lit).length,
    near: all.filter((card) => !card.lit && card.total - card.have === 1).length }
  const labels = { all: 'roomsWardrobeAll', lit: 'roomsWardrobeLit', near: 'wardrobePageCardsNear' } as const
  const cards = filter === 'all' ? all : wardrobeRoleCards(wardrobe, unlockAll, filter)
  return <>
    <div className="kun-wardrobe-chips" role="group" aria-label={t('wardrobePageTabCards')}>
      {(['all', 'lit', 'near'] as const).map((id) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => onFilter(id)}>
        {t(labels[id])}<span>{counts[id]}</span></button>)}
      <span className="kun-wardrobe-chips-note">{t('roomsWardrobeCardsHint')}</span>
    </div>
    <div className="kun-wardrobe-scroll">
      <div className="kun-wardrobe-cards">
        {cards.map((card) => {
          const on = selection?.kind === 'card' && selection.id === card.preset.id
          const rarity = KUN_AVATAR_RARITY_LABELS[card.rarity][language]
          return <button key={card.preset.id} type="button" className="kun-wardrobe-card rooms-wardrobe-rarity" data-rarity={card.rarity}
            data-hidden={!card.lit || undefined} aria-pressed={on} data-wardrobe-card={card.lit ? card.preset.id : 'unknown'}
            aria-label={card.lit ? `${card.preset.label[language]}，${rarity}，${t('roomsWardrobeLit')}`
              : `${t('roomsWardrobeUnknownCard')}，${t('roomsWardrobeCollected', { have: card.have, total: card.total })}`}
            onClick={() => onSelect(on ? null : { kind: 'card', id: card.preset.id })}>
            <WardrobeCodexCard card={card} language={language} />
            <strong>{card.lit ? card.preset.label[language] : t('roomsWardrobeUnknownCard')}</strong>
            <small>{card.lit ? `${rarity} · ${t('roomsWardrobeLit')}` : t('roomsWardrobeCollected', { have: card.have, total: card.total })}</small>
            {!card.lit ? <span className="kun-wardrobe-card-progress" aria-hidden="true">
              <span style={{ '--progress': `${Math.round(card.have / card.total * 100)}%` } as CSSProperties} /></span> : null}
          </button>
        })}
      </div>
    </div>
  </>
}
