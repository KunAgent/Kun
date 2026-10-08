import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Ban, Check, Lock, PaintBucket, Palette, RotateCcw, Smile, Sparkles, Upload, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  KUN_AVATAR_CATALOG, KUN_AVATAR_DEFAULT_PARTS, KUN_AVATAR_PRESETS, KUN_AVATAR_SCENES,
  KUN_AVATAR_RARITIES, KUN_AVATAR_RARITY_LABELS,
  canonicalKunAvatarKey, kunWardrobeItemKey, kunWardrobeMissingParts, kunWardrobeOwns, normalizeKunAvatarParts, randomKunAvatarParts, updateKunAvatarPart,
  type KunAvatarAccessoryCategory, type KunAvatarCategory, type KunAvatarParts, type KunAvatarRarity, type KunWardrobe, type RoomAvatarReference
} from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { composedAvatarLayerUrl } from './room-avatar-compositor'
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
type CardExtras = { locked?: boolean; fresh?: boolean; copies?: number; meta?: string }

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
 * With a wardrobe, unowned items show as locked silhouettes that only preview.
 */
export function RoomAvatarComposer({ id, label, avatar, user = false, disabled = false, photo = false,
  preview, previewControls, wardrobe = null, onChange, onUpload, onSeen }: {
  id: string; label: string; avatar?: RoomAvatarReference | null; user?: boolean; disabled?: boolean
  photo?: boolean; preview?: ReactNode; previewControls?: ReactNode
  /** Null means nothing is locked. */
  wardrobe?: KunWardrobe | null
  onChange: (avatar: RoomAvatarReference | null) => void; onUpload: () => void
  onSeen?: (keys: string[]) => void
}) {
  const { t, i18n } = useTranslation('common')
  const base = useId()
  const [category, setCategory] = useState<EditorCategory>('preset')
  const [notice, setNotice] = useState('')
  const [trying, setTrying] = useState<KunAvatarParts | null>(null)
  const [ownedOnly, setOwnedOnly] = useState(false)
  const parts = editableKunAvatarParts(avatar, id, user)
  const language = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const active = !photo && avatar?.kind !== 'uploaded'
  const owns = (slot: KunAvatarAccessoryCategory, partId: string) => !wardrobe || kunWardrobeOwns(wardrobe, slot, partId)
  const lit = (presetId: string) => !wardrobe || wardrobe.roles.includes(presetId)
  const fresh = (key: string) => Boolean(wardrobe) && !wardrobe!.seen.includes(key)
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
  // "New" marks fade once the user has looked at that shelf for a moment.
  useEffect(() => {
    if (!wardrobe || !onSeen) return
    const keys = category === 'preset' ? wardrobe.roles.map((role) => 'card/' + role)
      : isAccessory(category) ? KUN_AVATAR_CATALOG[category].map((part) => kunWardrobeItemKey(category, part.id)).filter((key) => (wardrobe.items[key] ?? 0) > 0) : []
    const unseen = keys.filter((key) => !wardrobe.seen.includes(key))
    if (!unseen.length) return
    const timer = setTimeout(() => onSeen(unseen), 2000)
    return () => clearTimeout(timer)
  }, [category, wardrobe, onSeen])
  const card = (key: string, text: string, selected: boolean, art: ReactNode, onClick: () => void, look?: KunAvatarParts,
    details?: { rarity: KunAvatarRarity; flavor: string }, extras: CardExtras = {}) => (
    <button key={key} type="button" className="rooms-avatar-composer-option" disabled={disabled}
      aria-label={text} aria-pressed={selected} data-rarity={details?.rarity} data-locked={extras.locked || undefined}
      aria-disabled={extras.locked || undefined} data-fresh={extras.fresh && !extras.locked ? true : undefined}
      onClick={extras.locked ? () => { setTrying(null); setNotice(t('roomsWardrobeLockedHint')) } : onClick}
      title={extras.locked ? t('roomsWardrobeLocked') : details ? `${KUN_AVATAR_RARITY_LABELS[details.rarity][language]} · ${details.flavor}` : undefined}
      aria-description={extras.locked ? t('roomsWardrobeLocked') : details ? KUN_AVATAR_RARITY_LABELS[details.rarity][language] : undefined}
      onPointerEnter={look ? () => tryOn(look) : undefined} onPointerLeave={look ? () => tryOn(null) : undefined}>
      <span className="rooms-avatar-option-art">{art}
        {extras.locked ? <span className="rooms-avatar-option-lock" aria-hidden="true"><Lock size={11} strokeWidth={2.5} /></span>
          : extras.copies && extras.copies > 1 ? <span className="rooms-avatar-option-copies" aria-hidden="true">{t('roomsWardrobeCount', { count: extras.copies })}</span> : null}
      </span>
      <span className="rooms-avatar-option-name">{text}</span>
      {extras.meta ? <span className="rooms-avatar-option-meta">{extras.meta}</span> : details ? <span className="rooms-avatar-option-rarity">
        <span aria-hidden="true">{'◆'.repeat(KUN_AVATAR_RARITIES.indexOf(details.rarity) + 1)}</span>
        {KUN_AVATAR_RARITY_LABELS[details.rarity][language]}
      </span> : null}
      {extras.fresh && !extras.locked ? <span className="rooms-avatar-option-new">{t('roomsWardrobeNew')}</span> : null}
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
      return KUN_AVATAR_PRESETS.filter((preset) => !ownedOnly || lit(preset.id)).map((preset) => {
        const open = lit(preset.id)
        const missing = wardrobe ? kunWardrobeMissingParts(wardrobe, preset.parts).length : 0
        return card(preset.id, preset.label[language],
          active && (avatar?.kind === 'builtin' ? avatar.id === preset.id : avatar?.kind === 'composed' &&
            canonicalKunAvatarKey(parts) === canonicalKunAvatarKey(preset.parts)),
          look(preset.parts), () => choose(composed({ ...preset.parts })), preset.parts, undefined,
          { locked: !open, fresh: open && fresh('card/' + preset.id),
            meta: !wardrobe ? undefined : open ? t('roomsWardrobeLit') : t('roomsWardrobeMissing', { count: missing }) })
      })
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
          <input type="color" disabled={disabled} value={parts.bg.startsWith('#') ? parts.bg : '#f7f5ef'}
            onChange={(event) => edit('bg', event.target.value)} />
        </label>
        <div className="rooms-avatar-scene-options">
          {KUN_AVATAR_SCENES.map((scene) => {
            const background = `scene:${scene.id}`
            const next = updateKunAvatarPart(parts, 'bg', background).parts
            return card(scene.id, scene.label[language], active && parts.bg === background,
              <img className="rooms-avatar-scene-art" src={composedAvatarLayerUrl(`scene/${scene.id}`, 128)}
                alt="" draggable={false} loading="lazy" />, () => edit('bg', background), next)
          })}
        </div>
      </>
    }
    const slot = category
    return <>
      {card('none', t('roomsAvatarNone'), active && !parts[slot], <Ban size={22} aria-hidden="true" />,
        () => edit(slot, undefined), updateKunAvatarPart(parts, slot, undefined).parts)}
      {KUN_AVATAR_CATALOG[slot].filter((part) => !ownedOnly || owns(slot, part.id)).map((part) => {
        const worn = active && parts[slot] === part.id
        const owned = owns(slot, part.id), key = kunWardrobeItemKey(slot, part.id)
        // Clicking what is already worn takes it off, like any wardrobe.
        const art = <RoomAvatarItemArt category={slot} id={part.id} size={60} />
        return card(part.id, part.label[language], worn, art,
          () => edit(slot, worn ? undefined : part.id), updateKunAvatarPart(parts, slot, part.id).parts,
          { rarity: part.rarity, flavor: part.flavor[language] },
          { locked: !owned, fresh: owned && fresh(key), copies: wardrobe?.items[key] })
      })}
    </>
  }
  const panel = `${base}-panel`
  const count = isAccessory(category) || category === 'color' || category === 'face' ? KUN_AVATAR_CATALOG[category].length
    : category === 'preset' ? KUN_AVATAR_PRESETS.length : 0
  const owned = wardrobe && isAccessory(category) ? KUN_AVATAR_CATALOG[category].filter((part) => owns(category, part.id)).length
    : wardrobe && category === 'preset' ? KUN_AVATAR_PRESETS.filter((preset) => lit(preset.id)).length : null
  const random = () => choose(composed(randomKunAvatarParts(Math.random, wardrobe ? (slot, partId) => kunWardrobeOwns(wardrobe, slot, partId) : undefined)))
  return <div className="rooms-avatar-composer">
    <div className="rooms-avatar-studio">
      <RoomAvatarStage id={id} label={label} user={user} avatar={avatar} parts={parts} trying={trying} active={active}
        preview={preview} previewControls={previewControls} notice={notice} disabled={disabled} language={language}
        onSlot={selectTab} onRemove={(slot) => edit(slot, undefined)} onRandom={random} />
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
          {owned !== null ? <span>{t('roomsWardrobeOwned', { owned, total: count })}</span>
            : count ? <span>{t('roomsAvatarItemCount', { count })}</span> : null}
          <span>{t(category === 'bg' ? 'roomsAvatarBackdropHint' : 'roomsAvatarWardrobeHint')}</span>
          {owned !== null ? <label className="rooms-avatar-wardrobe-filter">
            <input type="checkbox" checked={ownedOnly} onChange={(event) => setOwnedOnly(event.target.checked)} />{t('roomsWardrobeOwnedOnly')}
          </label> : null}
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
