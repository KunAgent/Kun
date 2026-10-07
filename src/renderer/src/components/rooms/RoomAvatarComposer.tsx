import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Ban, Check, PaintBucket, Palette, RotateCcw, Smile, Sparkles, Upload, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  KUN_AVATAR_CATALOG, KUN_AVATAR_DEFAULT_PARTS, KUN_AVATAR_PRESETS,
  canonicalKunAvatarKey, normalizeKunAvatarParts, randomKunAvatarParts, updateKunAvatarPart,
  type KunAvatarAccessoryCategory, type KunAvatarCategory, type KunAvatarParts, type RoomAvatarReference
} from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { RoomAvatarItemArt } from './RoomAvatarItemArt'
import { AVATAR_SLOTS, RoomAvatarStage } from './RoomAvatarStage'
import { avatarForIdentity } from './room-avatar-catalog'
import './room-avatar-composer.css'

const categories = {
  preset: 'roomsAvatarPresets', color: 'roomsAvatarBodyColor', face: 'roomsAvatarExpression',
  headwear: 'roomsAvatarHeadwear', glasses: 'roomsAvatarGlasses', outfit: 'roomsAvatarOutfit',
  prop: 'roomsAvatarProp', bg: 'roomsAvatarBackground'
} as const
type EditorCategory = keyof typeof categories
const tabs: ReadonlyArray<{ id: EditorCategory; icon: LucideIcon }> = [
  { id: 'preset', icon: Sparkles }, ...AVATAR_SLOTS.map((slot) => ({ id: slot.id, icon: slot.icon })),
  { id: 'color', icon: Palette }, { id: 'face', icon: Smile }, { id: 'bg', icon: PaintBucket }
]
const backgroundColors = ['#f7f5ef', '#eef6ff', '#eaf6ef', '#fbf0f3', '#fff4d6', '#1d2530']
const isAccessory = (category: EditorCategory): category is KunAvatarAccessoryCategory =>
  AVATAR_SLOTS.some((slot) => slot.id === category)

function composed(parts: KunAvatarParts): RoomAvatarReference {
  return { kind: 'composed', version: 1, parts }
}

/** Opening the editor never migrates an existing avatar; only an explicit edit does. */
export function editableKunAvatarParts(avatar: RoomAvatarReference | null | undefined, id: string, user = false): KunAvatarParts {
  if (avatar?.kind === 'composed') return normalizeKunAvatarParts(avatar.parts)
  const presetId = avatar?.kind === 'builtin' ? avatar.id : !avatar && !user ? avatarForIdentity(id).id : undefined
  return normalizeKunAvatarParts(KUN_AVATAR_PRESETS.find((preset) => preset.id === presetId)?.parts ?? KUN_AVATAR_DEFAULT_PARTS)
}

/**
 * A dress-up studio: the look on stage, a wardrobe beside it. Hovering an item
 * tries it on; clicking wears it, and clicking a worn item takes it off.
 */
export function RoomAvatarComposer({ id, label, avatar, user = false, disabled = false, photo = false,
  preview, previewControls, onChange, onUpload }: {
  id: string; label: string; avatar?: RoomAvatarReference | null; user?: boolean; disabled?: boolean
  photo?: boolean; preview?: ReactNode; previewControls?: ReactNode
  onChange: (avatar: RoomAvatarReference | null) => void; onUpload: () => void
}) {
  const { t, i18n } = useTranslation('common')
  const base = useId()
  const [category, setCategory] = useState<EditorCategory>('preset')
  const [notice, setNotice] = useState('')
  const [trying, setTrying] = useState<KunAvatarParts | null>(null)
  const parts = editableKunAvatarParts(avatar, id, user)
  const language = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const active = !photo && avatar?.kind !== 'uploaded'
  const choose = (next: RoomAvatarReference | null) => { setTrying(null); setNotice(''); onChange(next) }
  const edit = (slot: KunAvatarCategory, value: string | undefined) => {
    const result = updateKunAvatarPart(parts, slot, value)
    setTrying(null)
    onChange(composed(result.parts))
    setNotice(result.removed.length ? t('roomsAvatarConflictsRemoved', {
      parts: result.removed.map((removed) => t(categories[removed])).join(', ')
    }) : '')
  }
  const tryOn = (next: KunAvatarParts | null) => { if (!disabled) setTrying(next) }
  const card = (key: string, text: string, selected: boolean, art: ReactNode, onClick: () => void, look?: KunAvatarParts) => (
    <button key={key} type="button" className="rooms-avatar-composer-option" disabled={disabled}
      aria-label={text} aria-pressed={selected} onClick={onClick}
      onPointerEnter={look ? () => tryOn(look) : undefined} onPointerLeave={look ? () => tryOn(null) : undefined}>
      <span className="rooms-avatar-option-art">{art}</span>
      <span className="rooms-avatar-option-name">{text}</span>
      {selected ? <span className="rooms-avatar-option-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></span> : null}
    </button>
  )
  const look = (next: KunAvatarParts, size = 60) =>
    <RoomAvatar avatar={composed(next)} id={`avatar-option-${canonicalKunAvatarKey(next)}`} label="" size={size} user />
  const selectTab = (next: EditorCategory) => { setCategory(next); setTrying(null) }
  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const index = (tabs.findIndex((tab) => tab.id === category) + step + tabs.length) % tabs.length
    selectTab(tabs[index]!.id)
    event.currentTarget.querySelector<HTMLElement>(`[data-avatar-tab="${tabs[index]!.id}"]`)?.focus()
  }
  const items = () => {
    if (category === 'preset') {
      return KUN_AVATAR_PRESETS.map((preset) => card(preset.id, preset.label[language],
        active && (avatar?.kind === 'builtin' ? avatar.id === preset.id : avatar?.kind === 'composed' &&
          canonicalKunAvatarKey(parts) === canonicalKunAvatarKey(preset.parts)),
        look(preset.parts), () => choose(composed({ ...preset.parts })), preset.parts))
    }
    if (category === 'color' || category === 'face') {
      return KUN_AVATAR_CATALOG[category].map((part) => {
        const next = updateKunAvatarPart(parts, category, part.id).parts
        return card(part.id, part.label[language], active && parts[category] === part.id,
          category === 'face' ? look(next, 48) : look(next), () => edit(category, part.id), next)
      })
    }
    if (category === 'bg') {
      return <>
        {backgroundColors.map((color) => <button key={color} type="button" disabled={disabled}
          className="rooms-avatar-composer-swatch" aria-label={t('roomsAvatarBackgroundColor', { color })}
          aria-pressed={active && parts.bg === color} style={{ background: color }} onClick={() => edit('bg', color)}
          onPointerEnter={() => tryOn(updateKunAvatarPart(parts, 'bg', color).parts)} onPointerLeave={() => tryOn(null)}>
          {active && parts.bg === color ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : null}
        </button>)}
        <button type="button" disabled={disabled} className="rooms-avatar-composer-transparent"
          aria-pressed={active && parts.bg === 'transparent'} onClick={() => edit('bg', 'transparent')}>{t('roomsAvatarTransparent')}</button>
        <label className="rooms-avatar-composer-custom-color">{t('roomsAvatarCustomBackground')}
          <input type="color" disabled={disabled} value={parts.bg === 'transparent' ? '#f7f5ef' : parts.bg}
            onChange={(event) => edit('bg', event.target.value)} />
        </label>
      </>
    }
    const slot = category
    return <>
      {card('none', t('roomsAvatarNone'), active && !parts[slot], <Ban size={22} aria-hidden="true" />,
        () => edit(slot, undefined), updateKunAvatarPart(parts, slot, undefined).parts)}
      {KUN_AVATAR_CATALOG[slot].map((part) => {
        const worn = active && parts[slot] === part.id
        // Clicking what is already worn takes it off, like any wardrobe.
        const art = slot === 'outfit' ? <RoomAvatarItemArt category={slot} id={part.id} size={88} height={56} mannequin={parts.color} />
          : <RoomAvatarItemArt category={slot} id={part.id} size={54} />
        return card(part.id, part.label[language], worn, art,
          () => edit(slot, worn ? undefined : part.id), updateKunAvatarPart(parts, slot, part.id).parts)
      })}
    </>
  }
  const panel = `${base}-panel`
  const count = isAccessory(category) || category === 'color' || category === 'face' ? KUN_AVATAR_CATALOG[category].length
    : category === 'preset' ? KUN_AVATAR_PRESETS.length : 0
  return <div className="rooms-avatar-composer">
    <div className="rooms-avatar-studio">
      <RoomAvatarStage id={id} label={label} user={user} avatar={avatar} parts={parts} trying={trying} active={active}
        preview={preview} previewControls={previewControls} notice={notice} disabled={disabled} language={language}
        onSlot={selectTab} onRemove={(slot) => edit(slot, undefined)} onRandom={() => choose(composed(randomKunAvatarParts()))} />
      <section className="rooms-avatar-wardrobe" aria-label={t('roomsAvatarWardrobe')}>
        <div className="rooms-avatar-wardrobe-tabs" role="tablist" aria-label={t('roomsAvatarCustomize')} onKeyDown={moveTab}>
          {tabs.map((tab) => <button key={tab.id} type="button" role="tab" id={`${base}-tab-${tab.id}`} data-avatar-tab={tab.id}
            aria-selected={category === tab.id} aria-controls={panel} tabIndex={category === tab.id ? 0 : -1}
            data-worn={isAccessory(tab.id) && active && parts[tab.id] ? true : undefined} onClick={() => selectTab(tab.id)}>
            <tab.icon size={18} aria-hidden="true" /><span>{t(categories[tab.id])}</span>
          </button>)}
        </div>
        <p className="rooms-avatar-wardrobe-hint">
          <strong>{t(categories[category])}</strong>
          {count ? <span>{t('roomsAvatarItemCount', { count })}</span> : null}
          <span>{t(category === 'bg' ? 'roomsAvatarBackdropHint' : 'roomsAvatarWardrobeHint')}</span>
        </p>
        <div className="rooms-avatar-composer-options" role="tabpanel" id={panel} data-category={category}
          aria-labelledby={`${base}-tab-${category}`} onPointerLeave={() => tryOn(null)}>
          {items()}
        </div>
      </section>
    </div>
    <div className="rooms-avatar-composer-actions">
      <button type="button" disabled={disabled} onClick={onUpload}><Upload size={16} aria-hidden="true" />{t('roomsAvatarUpload')}</button>
      <button type="button" disabled={disabled} onClick={() => choose(null)}><RotateCcw size={16} aria-hidden="true" />{t(user ? 'roomsAvatarRestoreKun' : 'roomsAvatarReset')}</button>
    </div>
  </div>
}
