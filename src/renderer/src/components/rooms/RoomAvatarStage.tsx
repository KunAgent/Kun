import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Dices, Glasses, GraduationCap, Shirt, Sparkles, WandSparkles, X, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  KUN_AVATAR_CATALOG, canonicalKunAvatarKey,
  type KunAvatarAccessoryCategory, type KunAvatarParts, type RoomAvatarReference
} from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { RoomAvatarItemArt } from './RoomAvatarItemArt'
import { useRoomComposedAvatar } from './room-avatar-composed'

const MIRROR = 208
export const AVATAR_SLOTS: ReadonlyArray<{ id: KunAvatarAccessoryCategory; label: string; icon: LucideIcon }> = [
  { id: 'headwear', label: 'roomsAvatarHeadwear', icon: GraduationCap },
  { id: 'glasses', label: 'roomsAvatarGlasses', icon: Glasses },
  { id: 'outfit', label: 'roomsAvatarOutfit', icon: Shirt },
  { id: 'prop', label: 'roomsAvatarProp', icon: WandSparkles }
]

/** Keeps the last finished composition on screen while the next one renders, so try-ons never flash. */
function StageComposition({ parts }: { parts: KunAvatarParts }) {
  const url = useRoomComposedAvatar({ kind: 'composed', version: 1, parts }, MIRROR)
  const [shown, setShown] = useState(url)
  useEffect(() => { if (url) setShown(url) }, [url])
  return shown ? <img className="rooms-avatar-art" data-composed src={shown} alt="" aria-hidden="true" draggable={false} />
    : <span className="rooms-avatar-stage-loading" aria-hidden="true" />
}

export function RoomAvatarStage({ id, label, user, avatar, parts, trying, active, preview, previewControls,
  notice, disabled, language, onSlot, onRemove, onRandom }: {
  id: string; label: string; user: boolean; avatar?: RoomAvatarReference | null
  parts: KunAvatarParts; trying: KunAvatarParts | null; active: boolean
  preview?: ReactNode; previewControls?: ReactNode; notice: string; disabled: boolean; language: 'zh' | 'en'
  onSlot: (slot: KunAvatarAccessoryCategory) => void; onRemove: (slot: KunAvatarAccessoryCategory) => void; onRandom: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const shownParts = trying ?? parts
  const composed = Boolean(trying) || avatar?.kind === 'composed'
  // A new committed look gets a small "ta-da"; hovering never replays it.
  const committed = avatar?.kind === 'composed' ? canonicalKunAvatarKey(avatar.parts) : JSON.stringify(avatar ?? null)
  const [pop, setPop] = useState(0)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setPop((value) => value + 1)
  }, [committed])
  const content = preview && !trying ? preview
    : composed ? <StageComposition parts={shownParts} />
      : <RoomAvatar id={id} user={user} avatar={avatar} label={label} size={MIRROR} />
  const chatAvatar: RoomAvatarReference | null | undefined = trying ? { kind: 'composed', version: 1, parts: trying } : avatar
  return <section className="rooms-avatar-stage" aria-label={label}>
    <div className="rooms-avatar-stage-spot" data-pop={pop % 2} data-popped={pop > 0 || undefined}>
      <Sparkles className="rooms-avatar-stage-sparkle" data-sparkle="1" size={18} aria-hidden="true" />
      <Sparkles className="rooms-avatar-stage-sparkle" data-sparkle="2" size={13} aria-hidden="true" />
      <Sparkles className="rooms-avatar-stage-sparkle" data-sparkle="3" size={15} aria-hidden="true" />
      <div className="rooms-avatar-composer-preview rooms-avatar-stage-mirror"
        data-transparent={composed && shownParts.bg === 'transparent' || undefined}>
        {content}
        {trying ? <span className="rooms-avatar-stage-badge">{t('roomsAvatarTryingOn')}</span> : null}
      </div>
      <span className="rooms-avatar-stage-floor" aria-hidden="true" />
    </div>
    <div className="rooms-avatar-stage-name">
      <strong title={label}>{label}</strong>
      <span><RoomAvatar id={id} user={user} avatar={chatAvatar} label={label} size={28} />{t('roomsAvatarInChat')}</span>
    </div>
    {previewControls}
    <div className="rooms-avatar-stage-slots" role="group" aria-label={t('roomsAvatarEquipped')}>
      {AVATAR_SLOTS.map((slot) => {
        const item = active ? KUN_AVATAR_CATALOG[slot.id].find((entry) => entry.id === parts[slot.id]) : undefined
        const name = item?.label[language]
        return <div key={slot.id} className="rooms-avatar-slot" data-filled={item ? true : undefined}>
          <button type="button" className="rooms-avatar-slot-open" disabled={disabled} onClick={() => onSlot(slot.id)}
            aria-label={item ? t('roomsAvatarSlotFilled', { slot: t(slot.label), item: name }) : t('roomsAvatarSlotEmpty', { slot: t(slot.label) })}>
            {item ? <RoomAvatarItemArt category={slot.id} id={item.id} size={38} /> : <slot.icon size={17} aria-hidden="true" />}
          </button>
          {item ? <button type="button" className="rooms-avatar-slot-remove" disabled={disabled}
            aria-label={t('roomsAvatarTakeOff', { item: name })} onClick={() => onRemove(slot.id)}><X size={11} aria-hidden="true" /></button> : null}
          <small>{t(slot.label)}</small>
        </div>
      })}
    </div>
    <button type="button" className="rooms-avatar-stage-random" disabled={disabled} onClick={onRandom}>
      <Dices size={16} aria-hidden="true" />{t('roomsAvatarRandom')}
    </button>
    <p className="rooms-avatar-composer-notice" role="status" aria-live="polite">{notice}</p>
  </section>
}
