import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { Glasses, GraduationCap, Shirt, WandSparkles, X, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { KUN_AVATAR_CATALOG, kunAvatarScene, type KunAvatarAccessoryCategory, type KunAvatarParts } from '@shared/rooms-api'
import { RoomAvatar } from '../rooms/RoomAvatar'
import { RoomAvatarItemArt } from '../rooms/RoomAvatarItemArt'
import { useRoomComposedAvatar } from '../rooms/room-avatar-composed'
import { composedAvatarLayerUrl } from '../rooms/room-avatar-compositor'
import { composedAvatar, WARDROBE_SLOTS, type WardrobeAvatar } from './wardrobe-page-model'

const FIGURE = 380
const SLOT_ICONS: Record<KunAvatarAccessoryCategory, LucideIcon> = { headwear: GraduationCap, glasses: Glasses, outfit: Shirt, prop: WandSparkles }
export const WARDROBE_SLOT_LABELS = {
  headwear: 'roomsAvatarHeadwear', glasses: 'roomsAvatarGlasses', outfit: 'roomsAvatarOutfit', prop: 'roomsAvatarProp'
} as const

/** Light text over scenes and dark backdrops. */
export function wardrobeDarkBackdrop(bg: string): boolean {
  if (bg.startsWith('scene:')) return true
  const hex = /^#([0-9a-f]{6})$/i.exec(bg)?.[1]
  if (!hex) return false
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.42
}

/** The bird alone on a transparent canvas; the stage paints the backdrop. Keeps the last frame while the next composes. */
function StageFigure({ parts }: { parts: KunAvatarParts }): ReactElement {
  const url = useRoomComposedAvatar(composedAvatar({ ...parts, bg: 'transparent' }), FIGURE, true, 'portrait')
  const [shown, setShown] = useState(url)
  useEffect(() => { if (url) setShown(url) }, [url])
  return shown ? <img className="kun-wardrobe-figure" src={shown} alt="" draggable={false} data-wardrobe-figure />
    : <span className="kun-wardrobe-figure kun-wardrobe-figure-loading" aria-hidden="true" />
}

/**
 * The fitting room: the user's look large in front of its own backdrop, the four equipment
 * slots in a column beside it, and how the look reads at chat size. Hovering an item in the
 * collection previews it here before it is worn; `notice` (the undo toast) sits at the bottom.
 */
export function WardrobeStage({ avatar, parts, dressed, trying, language, notice, onSlot, onRemove }: {
  avatar: WardrobeAvatar; parts: KunAvatarParts; dressed: boolean; trying: KunAvatarParts | null; language: 'zh' | 'en'
  notice?: ReactNode; onSlot: (slot: KunAvatarAccessoryCategory) => void; onRemove: (slot: KunAvatarAccessoryCategory) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const composed = Boolean(trying) || dressed
  const shown = trying ?? parts
  const bg = composed ? shown.bg : 'transparent'
  const scene = kunAvatarScene(bg)
  const sceneUrl = scene ? composedAvatarLayerUrl(`scene/${scene}`, 512) : undefined
  const worn = dressed ? WARDROBE_SLOTS.filter((slot) => parts[slot]).length : 0
  const style = {
    '--stage-tone': bg.startsWith('#') ? bg : undefined,
    backgroundImage: sceneUrl ? `url("${sceneUrl}")` : undefined
  } as CSSProperties
  const slot = (category: KunAvatarAccessoryCategory) => {
    const item = dressed ? KUN_AVATAR_CATALOG[category].find((entry) => entry.id === parts[category]) : undefined
    const Icon = SLOT_ICONS[category]
    const label = t(WARDROBE_SLOT_LABELS[category])
    return <div key={category} className="kun-wardrobe-slot rooms-wardrobe-rarity" data-rarity={item?.rarity} data-filled={item ? true : undefined}>
      <button type="button" className="kun-wardrobe-slot-open" onClick={() => onSlot(category)} data-wardrobe-slot={category}
        aria-label={item ? t('roomsAvatarSlotFilled', { slot: label, item: item.label[language] }) : t('roomsAvatarSlotEmpty', { slot: label })}
        title={item ? item.label[language] : label}>
        {item ? <RoomAvatarItemArt category={category} id={item.id} size={42} /> : <Icon size={20} strokeWidth={1.7} aria-hidden="true" />}
      </button>
      {item ? <button type="button" className="kun-wardrobe-slot-remove" onClick={() => onRemove(category)}
        aria-label={t('roomsAvatarTakeOff', { item: item.label[language] })} title={t('roomsAvatarTakeOff', { item: item.label[language] })}>
        <X size={10} strokeWidth={3} aria-hidden="true" /></button> : null}
      <small>{label}</small>
    </div>
  }
  return <section className="kun-wardrobe-stage" aria-label={t('wardrobePageStage')} style={style}
    data-scene={scene ? true : undefined} data-dark-backdrop={composed && wardrobeDarkBackdrop(bg) ? true : undefined}
    data-transparent={composed && bg === 'transparent' ? true : undefined}>
    <div className="kun-wardrobe-stage-top">
      <span className="kun-wardrobe-stage-title">
        <strong>{t('wardrobePageStage')}</strong>
        <small>{trying ? t('wardrobePageTrying') : worn ? t('wardrobePageWearing', { n: worn }) : t('wardrobePageWearingNone')}</small>
      </span>
      <span className="kun-wardrobe-chat" title={t('wardrobePageInChatHint')}>
        <RoomAvatar user id="user" avatar={trying ? composedAvatar(trying) : avatar} label="" size={28} />{t('roomsAvatarInChat')}
      </span>
    </div>
    {composed ? <StageFigure parts={shown} />
      : <span className="kun-wardrobe-portrait"><RoomAvatar user id="user" avatar={avatar} label={t('roomsMyAvatar')} size={200} /></span>}
    <div className="kun-wardrobe-slots">{WARDROBE_SLOTS.map(slot)}</div>
    {trying ? <span className="kun-wardrobe-trying" role="status">{t('wardrobePageTryBadge')}</span> : notice}
  </section>
}
