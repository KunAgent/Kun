import { useRef, type CSSProperties, type PointerEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  KUN_AVATAR_CATALOG, KUN_AVATAR_PRESETS, KUN_AVATAR_RARITIES, KUN_AVATAR_RARITY_LABELS, kunWardrobeItemKey, kunWardrobeItems,
  type KunAvatarRarity, type KunWardrobeDrop
} from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { RoomAvatarItemArt } from './RoomAvatarItemArt'
import { composedAvatarLayerUrl } from './room-avatar-compositor'
import './room-wardrobe-holo.css'

type Language = 'zh' | 'en'
/** Each rarity shows its card over its own painted scene; role cards use their own. */
const SCENES: Record<KunAvatarRarity, string> = { common: 'sunset-bay', rare: 'night-study', epic: 'laboratory', legendary: 'star-deck' }
const CATEGORY_LABELS = { headwear: 'roomsAvatarHeadwear', glasses: 'roomsAvatarGlasses', outfit: 'roomsAvatarOutfit', prop: 'roomsAvatarProp' } as const
const pad = (value: number) => String(value).padStart(2, '0')
const clamp = (value: number) => Math.min(1, Math.max(0, value))

export function wardrobeDropDetails(drop: KunWardrobeDrop, language: Language) {
  const item = drop.item ? KUN_AVATAR_CATALOG[drop.item.category].find((entry) => entry.id === drop.item!.id) : undefined
  const preset = drop.cardId ? KUN_AVATAR_PRESETS.find((entry) => entry.id === drop.cardId) : undefined
  return { item, preset, name: item?.label[language] ?? preset?.label[language] ?? '', flavor: item?.flavor[language] ?? '' }
}

/**
 * One opened bottle as a holographic flash card: a painted scene, the item in front of it, a foil
 * whose finish follows rarity (none, silver, rainbow, gold with glitter) and a glare that tracks the
 * pointer. Face down it shows the shared card back, glowing in the rarity color when `hint` is set.
 */
export function WardrobeResultCard({ drop, size, faceUp = true, hint = false, sway = false, index = 0, language, label, onClick }: {
  drop: KunWardrobeDrop; size: 'large' | 'small'; faceUp?: boolean; hint?: boolean; sway?: boolean; index?: number
  language: Language; label?: string; onClick?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const root = useRef<HTMLDivElement>(null)
  const { item, preset, name } = wardrobeDropDetails(drop, language)
  const large = size === 'large'
  const level = KUN_AVATAR_RARITIES.indexOf(drop.rarity) + 1
  const kind = drop.kind === 'card' ? t('roomsWardrobeCardKind') : drop.duplicate ? t('roomsGachaDuplicate')
    : drop.item ? t(CATEGORY_LABELS[drop.item.category]) : ''
  const sub = `${KUN_AVATAR_RARITY_LABELS[drop.rarity][language]}${kind ? ` · ${kind}` : ''}`
  const items = kunWardrobeItems()
  const number = drop.kind === 'card' && preset
    ? `ROLE ${pad(KUN_AVATAR_PRESETS.indexOf(preset) + 1)} / ${KUN_AVATAR_PRESETS.length}`
    : drop.item ? `No.${pad(items.findIndex((entry) => entry.key === kunWardrobeItemKey(drop.item!.category, drop.item!.id)) + 1)} / ${items.length}` : ''
  const tier = large ? 512 : 256
  const scene = composedAvatarLayerUrl(`scene/${preset ? preset.cardScene : SCENES[drop.rarity]}`, tier)
  const back = composedAvatarLayerUrl('card/back', tier)
  // Pointer tilt writes CSS variables straight to the element, so moving the mouse never re-renders.
  const tilt = (event: PointerEvent<HTMLDivElement>) => {
    const node = root.current
    if (!node || !faceUp) return
    const rect = node.getBoundingClientRect()
    const x = clamp((event.clientX - rect.left) / Math.max(1, rect.width)), y = clamp((event.clientY - rect.top) / Math.max(1, rect.height))
    node.style.setProperty('--mx', `${Math.round(x * 100)}%`)
    node.style.setProperty('--my', `${Math.round(y * 100)}%`)
    node.style.setProperty('--tx', (x * 2 - 1).toFixed(3))
    node.style.setProperty('--ty', (y * 2 - 1).toFixed(3))
    node.dataset.tilting = 'true'
  }
  const rest = () => {
    const node = root.current
    if (!node) return
    for (const name of ['--mx', '--my', '--tx', '--ty']) node.style.removeProperty(name)
    delete node.dataset.tilting
  }
  const faces = <>
    <span className="kun-holo-face kun-holo-front" aria-hidden={!faceUp}>
      {scene ? <span className="kun-holo-scene" style={{ backgroundImage: `url("${scene}")` }} /> : null}
      <span className="kun-holo-tint" />
      <span className="kun-holo-halo" />
      <span className="kun-holo-subject">
        {drop.item && item ? <RoomAvatarItemArt category={drop.item.category} id={drop.item.id} size={large ? 172 : 92} />
          : preset ? <RoomAvatar avatar={{ kind: 'composed', version: 1, parts: { ...preset.parts, bg: 'transparent' } }}
            id={`gacha-card-${drop.id}`} label="" size={large ? 176 : 96} user /> : null}
      </span>
      <span className="kun-holo-frame" />
      <span className="kun-holo-top">
        <span className="kun-holo-pips">{Array.from({ length: level }, (_, pip) => <span key={pip} />)}</span>
        {large ? <span className="kun-holo-number">{number}</span> : null}
      </span>
      {drop.upgraded ? <span className="kun-holo-tag" data-tone="pity">{t('roomsGachaPityTag')}</span>
        : !drop.duplicate ? <span className="kun-holo-tag" data-tone="new">NEW</span> : null}
      <span className="kun-holo-plate"><strong className="kun-holo-name">{name}</strong><span className="kun-holo-sub">{sub}</span></span>
      {drop.duplicate ? <span className="kun-holo-stamp">+{drop.feathers}{large ? ` ${t('roomsWardrobeStatFeathers')}` : ''}</span> : null}
      <span className="kun-holo-foil" />
      <span className="kun-holo-lines" />
      <span className="kun-holo-sparkle" />
      <span className="kun-holo-glare" />
    </span>
    <span className="kun-holo-face kun-holo-back" aria-hidden={faceUp}>
      {back ? <img src={back} alt="" draggable={false} decoding="async" /> : null}
      <span className="kun-holo-back-glow" />
    </span>
  </>
  const accessible = label ?? (faceUp ? `${name}，${sub}` : t('roomsGachaFaceDown'))
  return <div ref={root} className="kun-holo rooms-wardrobe-rarity" data-rarity={drop.rarity} data-size={size} data-face-up={faceUp || undefined}
    data-hint={hint || undefined} data-sway={sway || undefined} data-gacha-card={drop.id} data-gacha-face={faceUp ? 'up' : 'down'}
    style={{ '--i': index } as CSSProperties} onPointerMove={tilt} onPointerLeave={rest}>
    {onClick ? <button type="button" className="kun-holo-card" onClick={onClick} aria-label={accessible}>{faces}</button>
      : <div className="kun-holo-card" role="img" aria-label={accessible}>{faces}</div>}
  </div>
}
