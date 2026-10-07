import { useState, type ReactNode } from 'react'
import { Shuffle, Upload, RotateCcw, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  KUN_AVATAR_CATALOG, KUN_AVATAR_DEFAULT_PARTS, KUN_AVATAR_PRESETS,
  canonicalKunAvatarKey, normalizeKunAvatarParts, randomKunAvatarParts, updateKunAvatarPart,
  type KunAvatarCategory, type KunAvatarParts, type RoomAvatarReference
} from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { avatarForIdentity } from './room-avatar-catalog'
import './room-avatar-composer.css'

const categories = {
  preset: 'roomsAvatarPresets', color: 'roomsAvatarBodyColor', face: 'roomsAvatarExpression',
  headwear: 'roomsAvatarHeadwear', glasses: 'roomsAvatarGlasses', outfit: 'roomsAvatarOutfit',
  prop: 'roomsAvatarProp', bg: 'roomsAvatarBackground'
} as const
type EditorCategory = keyof typeof categories
const backgroundColors = ['#f7f5ef', '#eef6ff', '#eaf6ef', '#fbf0f3', '#1d2530']
const accessoryCategories = new Set<EditorCategory>(['headwear', 'glasses', 'outfit', 'prop'])

function composed(parts: KunAvatarParts): RoomAvatarReference {
  return { kind: 'composed', version: 1, parts }
}

/** Opening the editor never migrates an existing avatar; only an explicit edit does. */
export function editableKunAvatarParts(avatar: RoomAvatarReference | null | undefined, id: string, user = false): KunAvatarParts {
  if (avatar?.kind === 'composed') return normalizeKunAvatarParts(avatar.parts)
  const presetId = avatar?.kind === 'builtin' ? avatar.id : !avatar && !user ? avatarForIdentity(id).id : undefined
  return normalizeKunAvatarParts(KUN_AVATAR_PRESETS.find((preset) => preset.id === presetId)?.parts ?? KUN_AVATAR_DEFAULT_PARTS)
}

export function RoomAvatarComposer({ id, label, avatar, user = false, disabled = false, photo = false,
  preview, previewControls, onChange, onUpload }: {
  id: string; label: string; avatar?: RoomAvatarReference | null; user?: boolean; disabled?: boolean
  photo?: boolean; preview?: ReactNode; previewControls?: ReactNode
  onChange: (avatar: RoomAvatarReference | null) => void; onUpload: () => void
}) {
  const { t, i18n } = useTranslation('common')
  const [category, setCategory] = useState<EditorCategory>('preset')
  const [notice, setNotice] = useState('')
  const parts = editableKunAvatarParts(avatar, id, user)
  const language = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const active = !photo && avatar?.kind !== 'uploaded'
  const choose = (next: RoomAvatarReference | null) => { setNotice(''); onChange(next) }
  const edit = (slot: KunAvatarCategory, value: string | undefined) => {
    const result = updateKunAvatarPart(parts, slot, value)
    onChange(composed(result.parts))
    setNotice(result.removed.length ? t('roomsAvatarConflictsRemoved', {
      parts: result.removed.map((removed) => t(categories[removed])).join(', ')
    }) : '')
  }
  const choice = (key: string, text: string, next: KunAvatarParts, selected: boolean, onClick: () => void) => (
    <button key={key} type="button" className="rooms-avatar-composer-option" disabled={disabled}
      aria-label={text} aria-pressed={selected} onClick={onClick}>
      <RoomAvatar avatar={composed(next)} id={`avatar-option-${key}`} label={text} size={64} user />
      <span>{text}</span>{selected ? <Check size={14} aria-hidden="true" /> : null}
    </button>
  )
  return <div className="rooms-avatar-composer">
    <div className="rooms-avatar-composer-preview">
      {preview ?? <RoomAvatar id={id} user={user} avatar={avatar} label={label} size={128} />}
      <button type="button" disabled={disabled} onClick={() => choose(composed(randomKunAvatarParts()))}>
        <Shuffle size={16} aria-hidden="true" />{t('roomsAvatarRandom')}
      </button>
    </div>
    {previewControls}
    <label className="rooms-avatar-composer-category">{t('roomsAvatarCustomize')}
      <select aria-label={t('roomsAvatarCustomize')} value={category} disabled={disabled}
        onChange={(event) => setCategory(event.target.value as EditorCategory)}>
        {Object.entries(categories).map(([key, translation]) => <option key={key} value={key}>{t(translation)}</option>)}
      </select>
    </label>
    <div className="rooms-avatar-composer-options" role="group" aria-label={t(categories[category])}>
      {category === 'preset' ? KUN_AVATAR_PRESETS.map((preset) => choice(preset.id, preset.label[language], preset.parts,
        !!active && (avatar?.kind === 'builtin' ? avatar.id === preset.id : avatar?.kind === 'composed' &&
          canonicalKunAvatarKey(parts) === canonicalKunAvatarKey(preset.parts)), () => choose(composed({ ...preset.parts }))))
        : category === 'bg' ? <>
          {backgroundColors.map((color) => <button key={color} type="button" disabled={disabled}
            className="rooms-avatar-composer-swatch" aria-label={t('roomsAvatarBackgroundColor', { color })}
            aria-pressed={!!active && parts.bg === color} style={{ background: color }} onClick={() => edit('bg', color)}>
            {active && parts.bg === color ? <Check size={18} aria-hidden="true" /> : null}
          </button>)}
          <button type="button" disabled={disabled} className="rooms-avatar-composer-transparent"
            aria-pressed={!!active && parts.bg === 'transparent'} onClick={() => edit('bg', 'transparent')}>{t('roomsAvatarTransparent')}</button>
          <label className="rooms-avatar-composer-custom-color">{t('roomsAvatarCustomBackground')}
            <input type="color" disabled={disabled} value={parts.bg === 'transparent' ? '#f7f5ef' : parts.bg}
              onChange={(event) => edit('bg', event.target.value)} />
          </label>
        </> : <>
          {accessoryCategories.has(category) ? choice('none', t('roomsAvatarNone'), updateKunAvatarPart(parts, category, undefined).parts,
            !!active && !parts[category], () => edit(category, undefined)) : null}
          {KUN_AVATAR_CATALOG[category].map((part) => choice(part.id, part.label[language], updateKunAvatarPart(parts, category, part.id).parts,
            !!active && parts[category] === part.id, () => edit(category, part.id)))}
        </>}
    </div>
    <p className="rooms-avatar-composer-notice" role="status" aria-live="polite">{notice}</p>
    <div className="rooms-avatar-composer-actions">
      <button type="button" disabled={disabled} onClick={onUpload}><Upload size={16} aria-hidden="true" />{t('roomsAvatarUpload')}</button>
      <button type="button" disabled={disabled} onClick={() => choose(null)}><RotateCcw size={16} aria-hidden="true" />{t(user ? 'roomsAvatarRestoreKun' : 'roomsAvatarReset')}</button>
    </div>
  </div>
}
