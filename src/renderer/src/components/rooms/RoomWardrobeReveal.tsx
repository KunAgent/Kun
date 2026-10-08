import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KUN_AVATAR_CATALOG, KUN_AVATAR_PRESETS, KUN_AVATAR_RARITIES, KUN_AVATAR_RARITY_LABELS, type RoomAvatarReference
} from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { RoomAvatarItemArt } from './RoomAvatarItemArt'
import { RoomModal } from './RoomModal'
import type { WardrobeOpenResult } from './room-wardrobe'
import './room-wardrobe.css'

/** What came out of a bottle: a new item, a duplicate turned into feathers, or a whole role card. */
export function RoomWardrobeReveal({ result, onClose, onWear, onDress }: {
  result: WardrobeOpenResult; onClose: () => void; onWear?: () => void
  /** Opens the dress-up studio; without it the Agent workspace's own editor is asked to open. */
  onDress?: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const language = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const { drop } = result
  const item = drop.item ? KUN_AVATAR_CATALOG[drop.item.category].find((entry) => entry.id === drop.item!.id) : undefined
  const preset = drop.cardId ? KUN_AVATAR_PRESETS.find((entry) => entry.id === drop.cardId) : undefined
  const title = drop.kind === 'card' ? t('roomsWardrobeRevealCard')
    : drop.duplicate ? t('roomsWardrobeRevealDuplicate', { count: drop.feathers }) : t('roomsWardrobeRevealNew')
  const rarity = KUN_AVATAR_RARITY_LABELS[drop.rarity][language]
  const look: RoomAvatarReference | undefined = preset ? { kind: 'composed', version: 1, parts: preset.parts } : undefined
  return <RoomModal title={t('roomsWardrobeBottle')} onClose={onClose}>
    <div className="rooms-wardrobe-reveal rooms-wardrobe-rarity" data-rarity={drop.rarity} data-kind={drop.kind} data-wardrobe-reveal>
      <p className="rooms-wardrobe-reveal-kicker">{title}</p>
      <div className="rooms-wardrobe-reveal-art">
        {look ? <RoomAvatar avatar={look} id={`wardrobe-card-${drop.cardId}`} label="" size={128} user />
          : item && drop.item ? <RoomAvatarItemArt category={drop.item.category} id={drop.item.id} size={120} /> : null}
      </div>
      <h3 className="rooms-wardrobe-reveal-name">{preset ? t('roomsWardrobeSetLabel', { name: preset.label[language] }) : item?.label[language]}</h3>
      <p className="rooms-wardrobe-reveal-rarity"><span aria-hidden="true">{'◆'.repeat(KUN_AVATAR_RARITIES.indexOf(drop.rarity) + 1)}</span>{rarity}</p>
      {item ? <p className="rooms-wardrobe-reveal-flavor">{item.flavor[language]}</p> : null}
      {drop.kind === 'card' && result.granted.length ? <p className="rooms-wardrobe-reveal-flavor">
        {result.granted.map((key) => {
          const [category, id] = key.split('/') as [keyof typeof KUN_AVATAR_CATALOG, string]
          return (KUN_AVATAR_CATALOG[category].find((entry) => entry.id === id) as { label?: { zh: string; en: string } } | undefined)?.label?.[language]
        }).filter(Boolean).join(' · ')}
      </p> : null}
      <div className="rooms-avatar-draft-actions rooms-wardrobe-reveal-actions">
        <button type="button" onClick={onClose}>{t('roomsWardrobeKeep')}</button>
        {onWear ? <button type="button" className="rooms-run-primary" onClick={() => { onWear(); onClose() }}>{t('roomsWardrobeWear')}</button>
          : <button type="button" className="rooms-run-primary" onClick={() => { onClose(); if (onDress) onDress(); else window.dispatchEvent(new Event('kun-room-user-avatar')) }}>{t('roomsWardrobeGoDress')}</button>}
      </div>
    </div>
  </RoomModal>
}
