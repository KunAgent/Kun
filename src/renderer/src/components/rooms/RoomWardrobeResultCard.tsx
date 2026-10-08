import type { CSSProperties, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KUN_AVATAR_CATALOG, KUN_AVATAR_PRESETS, KUN_AVATAR_RARITIES, KUN_AVATAR_RARITY_LABELS, type KunWardrobeDrop
} from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { RoomAvatarItemArt } from './RoomAvatarItemArt'

type Language = 'zh' | 'en'

export function wardrobeDropDetails(drop: KunWardrobeDrop, language: Language) {
  const item = drop.item ? KUN_AVATAR_CATALOG[drop.item.category].find((entry) => entry.id === drop.item!.id) : undefined
  const preset = drop.cardId ? KUN_AVATAR_PRESETS.find((entry) => entry.id === drop.cardId) : undefined
  return { item, preset, name: item?.label[language] ?? preset?.label[language] ?? '', flavor: item?.flavor[language] ?? '' }
}

/** One opened bottle: art, name and rarity, with a NEW, guarantee or feather mark. */
export function WardrobeResultCard({ drop, size, index = 0, language }: {
  drop: KunWardrobeDrop; size: 'large' | 'small'; index?: number; language: Language
}): ReactElement {
  const { t } = useTranslation('common')
  const { item, preset, name, flavor } = wardrobeDropDetails(drop, language)
  const large = size === 'large'
  const level = KUN_AVATAR_RARITIES.indexOf(drop.rarity) + 1
  const label = KUN_AVATAR_RARITY_LABELS[drop.rarity][language] +
    (drop.kind === 'card' ? ` · ${t('roomsWardrobeCardKind')}` : drop.duplicate ? ` · ${t('roomsGachaDuplicate')}` : '')
  return <div className="kun-gacha-card rooms-wardrobe-rarity" data-rarity={drop.rarity} data-size={size}
    data-gacha-card={drop.id} title={flavor || undefined} style={{ '--i': index } as CSSProperties}>
    <span className="kun-gacha-card-haze" aria-hidden="true" />
    <span className="kun-gacha-pips" aria-hidden="true">{Array.from({ length: level }, (_, i) => <span key={i} />)}</span>
    {drop.upgraded ? <span className="kun-gacha-tag" data-tone="pity">{t('roomsGachaPityTag')}</span>
      : !drop.duplicate ? <span className="kun-gacha-tag" data-tone="new">NEW</span> : null}
    <span className="kun-gacha-card-art">
      {drop.item && item ? <RoomAvatarItemArt category={drop.item.category} id={drop.item.id} size={large ? 176 : 100} />
        : preset ? <RoomAvatar avatar={{ kind: 'composed', version: 1, parts: { ...preset.parts, bg: `scene:${preset.cardScene}` } }}
          id={`gacha-card-${drop.id}`} label="" size={large ? 168 : 96} user /> : null}
      {drop.duplicate ? <span className="kun-gacha-stamp">+{drop.feathers}{large ? ` ${t('roomsWardrobeStatFeathers')}` : ''}</span> : null}
    </span>
    <strong className="kun-gacha-card-name">{name}</strong>
    <span className="kun-gacha-chip">{label}</span>
    {large ? <p className="kun-gacha-card-flavor">{drop.duplicate ? t('roomsGachaDuplicateHint') : drop.kind === 'card' ? t('roomsGachaCardHint') : flavor}</p> : null}
  </div>
}
