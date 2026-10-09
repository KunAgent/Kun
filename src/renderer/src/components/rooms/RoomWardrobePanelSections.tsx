import type { ReactElement } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  KUN_AVATAR_CATALOG, KUN_AVATAR_PRESETS, KUN_AVATAR_RARITIES, KUN_AVATAR_RARITY_LABELS, KUN_WARDROBE_RULES,
  kunAvatarRarity, kunWardrobeItemKey, kunWardrobeItems, kunWardrobeMissingParts, kunWardrobePartKeys,
  type KunAvatarAccessoryCategory, type KunAvatarParts, type KunWardrobe, type KunWardrobeDrop, type KunWardrobeSettings
} from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { RoomAvatarItemArt } from './RoomAvatarItemArt'
import { WardrobeBottleIcon, WardrobeCardBack, WardrobeUnknownItem } from './RoomWardrobeBottle'
import { wardrobeDropSource } from './room-wardrobe-source'

export type WardrobeSelection = { kind: 'item'; key: string } | { kind: 'card'; id: string } | null
type Language = 'zh' | 'en'
const CATEGORIES: ReadonlyArray<KunAvatarAccessoryCategory | 'all'> = ['all', 'headwear', 'glasses', 'outfit', 'prop']
const CATEGORY_LABELS = { all: 'roomsWardrobeAll', headwear: 'roomsAvatarHeadwear', glasses: 'roomsAvatarGlasses',
  outfit: 'roomsAvatarOutfit', prop: 'roomsAvatarProp' } as const
const Pips = ({ rarity, dim = false }: { rarity: (typeof KUN_AVATAR_RARITIES)[number]; dim?: boolean }) =>
  <span className="rooms-wardrobe-pips" data-dim={dim || undefined} aria-hidden="true">
    {Array.from({ length: KUN_AVATAR_RARITIES.indexOf(rarity) + 1 }, (_, index) => <span key={index} />)}
  </span>

export function WardrobeItemsSection({ wardrobe, language, category, ownedOnly, selection, onCategory, onOwnedOnly, onSelect }: {
  wardrobe: KunWardrobe; language: Language; category: KunAvatarAccessoryCategory | 'all'; ownedOnly: boolean
  selection: WardrobeSelection; onCategory: (category: KunAvatarAccessoryCategory | 'all') => void
  onOwnedOnly: (value: boolean) => void; onSelect: (selection: WardrobeSelection) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const all = kunWardrobeItems()
  const copies = (key: string) => wardrobe.items[key] ?? 0
  const shown = all.filter((item) => (category === 'all' || item.category === category) && (!ownedOnly || copies(item.key) > 0))
    .sort((a, b) => Number(copies(b.key) > 0) - Number(copies(a.key) > 0))
  return <div className="rooms-wardrobe-panel-section">
    <div className="rooms-wardrobe-panel-filters">
      {CATEGORIES.map((id) => {
        const items = all.filter((item) => id === 'all' || item.category === id)
        return <button key={id} type="button" aria-pressed={category === id} onClick={() => onCategory(id)}>
          {t(CATEGORY_LABELS[id])}<span>{items.filter((item) => copies(item.key) > 0).length}/{items.length}</span>
        </button>
      })}
      <label className="rooms-avatar-wardrobe-filter"><input type="checkbox" checked={ownedOnly}
        onChange={(event) => onOwnedOnly(event.target.checked)} />{t('roomsWardrobeOwnedOnly')}</label>
    </div>
    <div className="rooms-wardrobe-panel-grid" data-columns="4">
      {shown.map((item) => {
        const owned = copies(item.key) > 0
        const part = KUN_AVATAR_CATALOG[item.category].find((entry) => entry.id === item.id)!
        const on = selection?.kind === 'item' && selection.key === item.key
        // An item not found yet keeps its secret: no art, no name, only how rare it is.
        if (!owned) {
          return <button key={item.key} type="button" className="rooms-wardrobe-panel-tile rooms-wardrobe-rarity" data-rarity={item.rarity}
            data-locked aria-pressed={on} data-wardrobe-item="unknown"
            aria-label={`${t('roomsWardrobeUnknownItem')}，${t('roomsWardrobeLocked')}`}
            onClick={() => onSelect(on ? null : { kind: 'item', key: item.key })}>
            <span className="rooms-wardrobe-panel-well"><WardrobeUnknownItem size={44} /></span>
            <Pips rarity={item.rarity} dim />
            <span className="rooms-wardrobe-panel-name">{t('roomsWardrobeUnknownItem')}</span>
          </button>
        }
        return <button key={item.key} type="button" className="rooms-wardrobe-panel-tile rooms-wardrobe-rarity" data-rarity={item.rarity}
          aria-pressed={on} data-wardrobe-item={item.key}
          aria-label={`${part.label[language]}，${KUN_AVATAR_RARITY_LABELS[item.rarity][language]}`}
          onClick={() => onSelect(on ? null : { kind: 'item', key: item.key })}>
          <span className="rooms-wardrobe-panel-well"><RoomAvatarItemArt category={item.category} id={item.id} size={50} /></span>
          <Pips rarity={item.rarity} />
          {!wardrobe.seen.includes(item.key) ? <span className="rooms-avatar-option-new">{t('roomsWardrobeNew')}</span> : null}
          {copies(item.key) > 1 ? <span className="rooms-avatar-option-copies" aria-hidden="true">{t('roomsWardrobeCount', { count: copies(item.key) })}</span> : null}
          <span className="rooms-wardrobe-panel-name">{part.label[language]}</span>
        </button>
      })}
    </div>
  </div>
}

export function WardrobeCardsSection({ wardrobe, language, selection, onSelect }: {
  wardrobe: KunWardrobe; language: Language; selection: WardrobeSelection; onSelect: (selection: WardrobeSelection) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const cards = KUN_AVATAR_PRESETS.map((preset) => {
    const total = kunWardrobePartKeys(preset.parts).length
    return { preset, lit: wardrobe.roles.includes(preset.id), total, have: total - kunWardrobeMissingParts(wardrobe, preset.parts).length }
  }).sort((a, b) => Number(b.lit) - Number(a.lit) || b.have / b.total - a.have / a.total)
  return <div className="rooms-wardrobe-panel-section">
    <p className="rooms-wardrobe-panel-note">{t('roomsWardrobeCardsHint')}</p>
    <div className="rooms-wardrobe-panel-grid" data-columns="3">
      {cards.map(({ preset, lit, total, have }) => {
        const on = selection?.kind === 'card' && selection.id === preset.id
        const rarity = kunAvatarRarity(preset.parts)
        const look: KunAvatarParts = { ...preset.parts, bg: `scene:${preset.cardScene}` }
        return <button key={preset.id} type="button" className="rooms-wardrobe-panel-card rooms-wardrobe-rarity" data-rarity={rarity}
          data-hidden={!lit || undefined} aria-pressed={on} data-wardrobe-card={lit ? preset.id : 'unknown'}
          aria-label={lit ? `${preset.label[language]}，${t('roomsWardrobeLit')}` : `${t('roomsWardrobeUnknownCard')}，${t('roomsWardrobeCollected', { have, total })}`}
          onClick={() => onSelect(on ? null : { kind: 'card', id: preset.id })}>
          <span className="rooms-wardrobe-panel-card-frame">
            {lit ? <RoomAvatar avatar={{ kind: 'composed', version: 1, parts: look }} id={`wardrobe-card-${preset.id}`} label="" size={92} user />
              : <WardrobeCardBack width={86} height={112} />}
          </span>
          <strong>{lit ? preset.label[language] : t('roomsWardrobeUnknownCard')}</strong>
          <small>{lit ? `${KUN_AVATAR_RARITY_LABELS[rarity][language]} · ${t('roomsWardrobeLit')}` : t('roomsWardrobeCollected', { have, total })}</small>
          {!lit ? <span className="rooms-wardrobe-panel-progress" aria-hidden="true"><span style={{ width: `${Math.round(have / total * 100)}%` }} /></span> : null}
        </button>
      })}
    </div>
  </div>
}

function when(value: string, language: Language): string {
  const date = new Date(value), now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay ? date.toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
}

export function WardrobeLogSection({ wardrobe, language }: { wardrobe: KunWardrobe; language: Language }): ReactElement {
  const { t } = useTranslation('common')
  const source = (drop: KunWardrobeDrop) => {
    return `${wardrobeDropSource(t, drop)} · ${when(drop.openedAt ?? drop.createdAt, language)}`
  }
  const rows = [...wardrobe.pending.map((drop) => ({ drop, pending: true })), ...(wardrobe.history ?? []).map((drop) => ({ drop, pending: false }))]
  if (!rows.length) return <p className="rooms-wardrobe-panel-empty">{t('roomsWardrobeLogEmpty')}</p>
  return <div className="rooms-wardrobe-panel-section">
    <p className="rooms-wardrobe-panel-note">{t('roomsWardrobeLogHint')}</p>
    <ul className="rooms-wardrobe-panel-log">
      {rows.map(({ drop, pending }) => {
        const item = drop.item ? KUN_AVATAR_CATALOG[drop.item.category].find((entry) => entry.id === drop.item!.id) : undefined
        const preset = drop.cardId ? KUN_AVATAR_PRESETS.find((entry) => entry.id === drop.cardId) : undefined
        const title = pending ? t('roomsWardrobeUnopened') : item?.label[language] ?? preset?.label[language] ?? ''
        const status = pending ? t('roomsWardrobePendingStatus') : drop.duplicate ? t('roomsWardrobeFeatherGain', { count: drop.feathers })
          : drop.kind === 'card' ? t('roomsWardrobeLit') : t('roomsWardrobeKept')
        return <li key={drop.id} className="rooms-wardrobe-rarity" data-rarity={pending ? undefined : drop.rarity} data-pending={pending || undefined}>
          <span className="rooms-wardrobe-panel-log-art">
            {pending ? <WardrobeBottleIcon size={32} state="sealed" />
              : drop.item ? <RoomAvatarItemArt category={drop.item.category} id={drop.item.id} size={32} />
                : preset ? <RoomAvatar avatar={{ kind: 'composed', version: 1, parts: preset.parts }} id={`wardrobe-log-${drop.id}`} label="" size={32} user /> : null}
          </span>
          <span className="rooms-wardrobe-panel-log-text">
            <span><strong>{title}</strong><em data-hidden={pending || undefined}>{pending ? t('roomsShelfOnShelf')
              : drop.kind === 'card' ? t('roomsWardrobeCardKind') : KUN_AVATAR_RARITY_LABELS[drop.rarity][language]}</em>
              {drop.upgraded ? <em data-tone="pity">{t('roomsGachaPityTag')}</em> : null}</span>
            <small>{source(drop)}</small>
          </span>
          <span className="rooms-wardrobe-panel-log-status" data-tone={pending ? 'wait' : drop.duplicate ? 'feather' : 'done'}>{status}</span>
        </li>
      })}
    </ul>
  </div>
}

export function WardrobeSettingsSection({ settings, busy, onChange }: {
  settings: KunWardrobeSettings; busy: boolean; onChange: (patch: Partial<KunWardrobeSettings>) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const rules = KUN_WARDROBE_RULES
  const toggle = (key: 'drops' | 'code', value: boolean, disabled = false) =>
    <button type="button" role="switch" aria-checked={value} disabled={busy || disabled} className="rooms-wardrobe-switch"
      data-wardrobe-setting={key} aria-label={t(key === 'drops' ? 'roomsWardrobeSettingDrops' : 'roomsWardrobeSettingCode')}
      onClick={() => onChange({ [key]: !value })}><span /></button>
  return <div className="rooms-wardrobe-panel-section rooms-wardrobe-panel-settings">
    <div className="rooms-wardrobe-panel-switches">
      <div><span><strong>{t('roomsWardrobeSettingDrops')}</strong><small>{t('roomsWardrobeSettingDropsHint')}</small></span>{toggle('drops', settings.drops)}</div>
      <div><span><strong>{t('roomsWardrobeSettingCode')}</strong><small>{t('roomsWardrobeSettingCodeHint')}</small></span>{toggle('code', settings.drops && settings.code, !settings.drops)}</div>
    </div>
    <fieldset className="rooms-wardrobe-panel-notice">
      <legend>{t('roomsWardrobeSettingNotice')}</legend>
      {(['card', 'quiet'] as const).map((value) => <label key={value} data-on={settings.notice === value || undefined}>
        <input type="radio" name="wardrobe-notice" checked={settings.notice === value} disabled={busy}
          onChange={() => onChange({ notice: value })} />
        <span><strong>{t(value === 'card' ? 'roomsWardrobeNoticeCard' : 'roomsWardrobeNoticeQuiet')}</strong>
          <small>{t(value === 'card' ? 'roomsWardrobeNoticeCardHint' : 'roomsWardrobeNoticeQuietHint')}</small></span>
      </label>)}
    </fieldset>
    <div className="rooms-wardrobe-panel-rules">
      <strong>{t('roomsWardrobeRulesTitle')}</strong>
      <ul>
        <li data-tone="legendary">{t('roomsWardrobeRuleDaily')}</li>
        <li data-tone="rare">{t('roomsWardrobeRuleRate', { rate: Math.round(rules.dropRate * 100) })}</li>
        <li data-tone="rare">{t('roomsWardrobeRulePity', { count: rules.pity })}</li>
        <li>{t('roomsWardrobeRuleCap', { count: rules.dailyCap })}</li>
        <li>{t('roomsWardrobeRuleInterval', { seconds: rules.minIntervalMs / 1000 })}</li>
        <li data-tone="legendary">{t('roomsWardrobeRuleTenPull', { count: rules.tenPull })}</li>
        <li>{t('roomsWardrobeRuleShelf', { count: rules.shelfLimit })}</li>
        <li data-tone="epic">{t('roomsWardrobeRuleCard', { rate: Math.round(rules.cardRate * 100) })}</li>
        <li data-tone="legendary">{t('roomsWardrobeRuleFeathers', { common: rules.duplicateFeathers.common, rare: rules.duplicateFeathers.rare,
          epic: rules.duplicateFeathers.epic, legendary: rules.duplicateFeathers.legendary })}</li>
      </ul>
    </div>
    <p className="rooms-wardrobe-panel-note"><Check size={12} aria-hidden="true" />{t('roomsWardrobeSettingsFoot')}</p>
  </div>
}

export const wardrobeItemCategory = (key: string) => key.split('/')[0] as KunAvatarAccessoryCategory
export const wardrobeItemId = (key: string) => key.split('/')[1] ?? ''
export const wardrobeItemKeyOf = kunWardrobeItemKey
