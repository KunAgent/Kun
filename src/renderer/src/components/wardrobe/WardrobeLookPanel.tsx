import type { ReactElement, ReactNode } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  KUN_AVATAR_CATALOG, KUN_AVATAR_SCENES, canonicalKunAvatarKey, updateKunAvatarPart, type KunAvatarCategory, type KunAvatarParts
} from '@shared/rooms-api'
import { RoomAvatar } from '../rooms/RoomAvatar'
import { composedAvatarLayerUrl } from '../rooms/room-avatar-compositor'
import { composedAvatar } from './wardrobe-page-model'

const BACKGROUND_COLORS = ['#f7f5ef', '#eef6ff', '#eaf6ef', '#fbf0f3', '#fff4d6', '#1d2530']
const Tick = () => <span className="kun-wardrobe-tick" aria-hidden="true"><Check size={10} strokeWidth={3.4} /></span>

/** Color, expression and backdrop: never collected, always free to change. Hover previews on the stage. */
export function WardrobeLookPanel({ parts, dressed, language, onPick, onTry, onEndTry }: {
  parts: KunAvatarParts; dressed: boolean; language: 'zh' | 'en'
  onPick: (next: KunAvatarParts, name: string) => void; onTry: (next: KunAvatarParts) => void; onEndTry: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const next = (category: KunAvatarCategory, value: string) => updateKunAvatarPart(parts, category, value as never).parts
  const tile = (key: string, name: string, selected: boolean, art: ReactNode, look: KunAvatarParts) =>
    <button key={key} type="button" className="kun-wardrobe-look-tile" aria-pressed={selected} data-wardrobe-look={key}
      onPointerEnter={() => onTry(look)} onClick={() => onPick(look, name)}>
      {art}<span>{name}</span>{selected ? <Tick /> : null}
    </button>
  const portrait = (look: KunAvatarParts, size: number, framing?: 'face') =>
    <RoomAvatar avatar={composedAvatar(look)} id={`wardrobe-look-${canonicalKunAvatarKey(look)}-${size}`} label="" size={size} framing={framing} user />
  const bg = dressed ? parts.bg : ''
  return <div className="kun-wardrobe-look" onPointerLeave={onEndTry}>
    <section>
      <header><strong>{t('roomsAvatarBodyColor')}</strong><span>{t('wardrobePageLookFree')}</span></header>
      <div className="kun-wardrobe-look-grid">
        {KUN_AVATAR_CATALOG.color.map((color) => {
          const look = next('color', color.id)
          return tile(`color-${color.id}`, color.label[language], dressed && parts.color === color.id, portrait(look, 72), look)
        })}
      </div>
    </section>
    <section>
      <header><strong>{t('roomsAvatarExpression')}</strong></header>
      <div className="kun-wardrobe-look-grid">
        {KUN_AVATAR_CATALOG.face.map((face) => {
          const look = next('face', face.id)
          return tile(`face-${face.id}`, face.label[language], dressed && parts.face === face.id, portrait(look, 60, 'face'), look)
        })}
      </div>
    </section>
    <section>
      <header><strong>{t('roomsAvatarBackground')}</strong><span>{t('roomsAvatarBackdropHint')}</span></header>
      <div className="kun-wardrobe-swatches">
        {BACKGROUND_COLORS.map((color) => {
          const look = next('bg', color)
          return <button key={color} type="button" className="kun-wardrobe-swatch" style={{ background: color }} aria-pressed={bg === color}
            aria-label={t('roomsAvatarBackgroundColor', { color })} data-dark={color === '#1d2530' || undefined}
            onPointerEnter={() => onTry(look)} onClick={() => onPick(look, color)}>
            {bg === color ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : null}
          </button>
        })}
        <button type="button" className="kun-wardrobe-swatch kun-wardrobe-swatch-clear" aria-pressed={bg === 'transparent'}
          onPointerEnter={() => onTry(next('bg', 'transparent'))} onClick={() => onPick(next('bg', 'transparent'), t('roomsAvatarTransparent'))}>
          {t('roomsAvatarTransparent')}</button>
        <label className="kun-wardrobe-swatch-custom">{t('roomsAvatarCustomBackground')}
          <input type="color" value={bg.startsWith('#') ? bg : '#f7f5ef'}
            onChange={(event) => onPick(next('bg', event.target.value), event.target.value)} /></label>
      </div>
      <div className="kun-wardrobe-scenes">
        {KUN_AVATAR_SCENES.map((scene) => {
          const look = next('bg', `scene:${scene.id}`)
          const src = composedAvatarLayerUrl(`scene/${scene.id}`, 256)
          return tile(`scene-${scene.id}`, scene.label[language], bg === `scene:${scene.id}`,
            src ? <img src={src} alt="" draggable={false} loading="lazy" /> : <span className="kun-wardrobe-scene-blank" />, look)
        })}
      </div>
    </section>
  </div>
}
