import { useEffect, useState, type ReactElement } from 'react'
import { Check, Feather, Shirt, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  KUN_AVATAR_CATALOG, KUN_AVATAR_PRESETS, KUN_AVATAR_RARITY_LABELS, KUN_WARDROBE_RULES, kunAvatarRarity,
  kunWardrobeItemRarity, kunWardrobeLocalDate, kunWardrobeProgress, normalizeKunAvatarParts, updateKunAvatarPart,
  type KunAvatarAccessoryCategory, type KunWardrobeItemKey, type KunWardrobeSettings, type RoomUserProfileDetail
} from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { RoomAvatarItemArt } from './RoomAvatarItemArt'
import { RoomUserAvatarEditor } from './RoomUserAvatarEditor'
import { WardrobeCardBack } from './RoomWardrobeBottle'
import { useWardrobeOpener } from './RoomWardrobeOpening'
import { RoomWardrobeShelf } from './RoomWardrobeShelf'
import {
  WardrobeCardsSection, WardrobeItemsSection, WardrobeLogSection, WardrobeSettingsSection,
  wardrobeItemCategory, wardrobeItemId, type WardrobeSelection
} from './RoomWardrobePanelSections'
import {
  exchangeWardrobeItem, markWardrobeSeen, updateWardrobeSettings, useWardrobe, wardrobeSettings
} from './room-wardrobe'
import { wearDropOnMe, wearOnMe } from './room-wardrobe-wear'
import { acceptRoomUserProfile, useRoomUserProfile } from './room-user-profile'
import { roomsRequest } from './rooms-client'
import './room-avatar-composer.css'
import './room-wardrobe.css'
import './room-wardrobe-panel.css'

type Tab = 'items' | 'cards' | 'log' | 'settings'
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'items', label: 'roomsWardrobeTabItems' }, { id: 'cards', label: 'roomsWardrobeTabCards' },
  { id: 'log', label: 'roomsWardrobeTabLog' }, { id: 'settings', label: 'roomsWardrobeTabSettings' }
]

/** The wardrobe in the right panel: progress, today's bottles, the collection and drop settings. */
export function RoomWardrobePanel({ active = true }: { active?: boolean }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const language = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const state = useWardrobe(active)
  const profile = useRoomUserProfile((value) => value.revision)
  const [tab, setTab] = useState<Tab>('items')
  const [category, setCategory] = useState<KunAvatarAccessoryCategory | 'all'>('all')
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [selection, setSelection] = useState<WardrobeSelection>(null)
  const [dressing, setDressing] = useState(false), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const opener = useWardrobeOpener({ onWear: wearDropOnMe, onDress: () => setDressing(true) })
  useEffect(() => {
    if (!active || profile !== null) return
    void roomsRequest<RoomUserProfileDetail>('/v1/rooms/user-profile').then(acceptRoomUserProfile).catch(() => undefined)
  }, [active, profile])
  const wardrobe = state.wardrobe
  // New items fade their marks once the shelf has been on screen for a moment.
  useEffect(() => {
    if (!active || tab !== 'items' || !wardrobe) return
    const unseen = Object.keys(wardrobe.items).filter((key) => wardrobe.items[key]! > 0 && !wardrobe.seen.includes(key))
    if (!unseen.length) return
    const timer = setTimeout(() => void markWardrobeSeen(unseen).catch(() => undefined), 2500)
    return () => clearTimeout(timer)
  }, [active, tab, wardrobe])
  const run = async (work: () => Promise<void>, done?: string) => {
    setBusy(true); setError(''); setNotice('')
    try { await work(); if (done) setNotice(done) } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  if (!wardrobe) {
    return <div className="rooms-wardrobe-panel" data-wardrobe-panel="loading">
      <p className={state.error ? 'rooms-run-error' : 'rooms-wardrobe-panel-empty'} role={state.error ? 'alert' : undefined}>
        {state.error || t('roomsLoading')}</p>
    </div>
  }
  const progress = kunWardrobeProgress(wardrobe)
  const settings = wardrobeSettings(wardrobe)
  const today = wardrobe.daily.date === kunWardrobeLocalDate(new Date()) ? wardrobe.daily.drops : 0
  const status = !settings.drops ? t('roomsWardrobeDropsOff') : today >= KUN_WARDROBE_RULES.dailyCap ? t('roomsWardrobeDailyFull')
    : today > 0 ? t('roomsWardrobeFirstDone', { count: progress.untilPity }) : t('roomsWardrobeFirstPending')
  const saveSettings = (patch: Partial<KunWardrobeSettings>) => run(() => updateWardrobeSettings(patch))
  const sheet = (() => {
    if (selection?.kind === 'item') {
      const key = selection.key as KunWardrobeItemKey
      const category = wardrobeItemCategory(key), id = wardrobeItemId(key)
      const part = KUN_AVATAR_CATALOG[category].find((entry) => entry.id === id)
      if (!part) return null
      const owned = (wardrobe.items[key] ?? 0) > 0
      const price = KUN_WARDROBE_RULES.exchangeFeathers[kunWardrobeItemRarity(key)]
      return { art: <RoomAvatarItemArt category={category} id={id} size={40} />, locked: !owned, rarity: part.rarity,
        title: `${part.label[language]} · ${KUN_AVATAR_RARITY_LABELS[part.rarity][language]}`,
        text: owned ? part.flavor[language] : t('roomsWardrobeExchangeHint', { price, missing: Math.max(0, price - wardrobe.feathers) }),
        action: owned ? t('roomsWardrobeWearOnMe') : t('roomsWardrobeExchange'),
        enabled: owned || wardrobe.feathers >= price,
        run: owned ? () => run(() => wearOnMe((parts) => updateKunAvatarPart(parts, category, id as never).parts), t('roomsWardrobeWorn'))
          : () => run(() => exchangeWardrobeItem(key), t('roomsWardrobeExchanged', { item: part.label[language] })) }
    }
    if (selection?.kind === 'card') {
      const preset = KUN_AVATAR_PRESETS.find((entry) => entry.id === selection.id)
      if (!preset) return null
      const lit = wardrobe.roles.includes(preset.id)
      const rarity = kunAvatarRarity(preset.parts)
      return lit ? { art: <RoomAvatar avatar={{ kind: 'composed', version: 1, parts: preset.parts }} id={`wardrobe-sheet-${preset.id}`} label="" size={44} user />,
        locked: false, rarity, title: `${preset.label[language]} · ${t('roomsWardrobeLit')}`, text: t('roomsWardrobeCardWearHint'),
        action: t('roomsWardrobeWearSet'), enabled: true,
        run: () => run(() => wearOnMe((parts) => normalizeKunAvatarParts({ ...preset.parts, bg: parts.bg })), t('roomsWardrobeWorn')) }
        : { art: <WardrobeCardBack width={34} height={44} />, locked: true, rarity, title: t('roomsWardrobeUnknownCard'),
          text: t('roomsWardrobeUnknownCardHint'), action: t('roomsWardrobeKeepCollecting'), enabled: false, run: () => undefined }
    }
    return null
  })()
  return <div className="rooms-wardrobe-panel" data-wardrobe-panel="ready">
    <section className="rooms-wardrobe-panel-head" aria-label={t('roomsWardrobeMine')}>
      <div className="rooms-wardrobe-panel-me">
        <RoomAvatar user id="user" label={t('roomsMyAvatar')} size={52} />
        <span className="rooms-wardrobe-panel-me-text"><strong>{t('roomsWardrobeMine')}</strong><small>{t('roomsWardrobeMineHint')}</small></span>
        <button type="button" className="rooms-wardrobe-panel-dress" onClick={() => setDressing(true)} data-wardrobe-dress>
          <Shirt size={15} aria-hidden="true" />{t('roomsWardrobeDress')}</button>
      </div>
      <div className="rooms-wardrobe-panel-stats">
        {[{ icon: Shirt, label: 'roomsWardrobeStatItems', value: progress.ownedItems, total: progress.totalItems, tone: 'rare' },
          { icon: Sparkles, label: 'roomsWardrobeStatCards', value: progress.litCards, total: progress.totalCards, tone: 'epic' },
          { icon: Feather, label: 'roomsWardrobeStatFeathers', value: progress.feathers, total: 0, tone: 'legendary' }].map((stat) =>
          <div key={stat.label} data-tone={stat.tone}>
            <span><stat.icon size={12} aria-hidden="true" />{t(stat.label)}</span>
            <strong>{stat.value}{stat.total ? <small> / {stat.total}</small> : null}</strong>
            <i aria-hidden="true"><b style={{ width: `${Math.min(100, Math.round(stat.total ? stat.value / stat.total * 100 : stat.value / 80 * 100))}%` }} /></i>
          </div>)}
      </div>
      <div className="rooms-wardrobe-panel-today" data-wardrobe-today={today}>
        <div><strong>{t('roomsWardrobeToday')}</strong><span>{t('roomsWardrobeTodayCount', { count: today, cap: KUN_WARDROBE_RULES.dailyCap })}</span>
          <span className="rooms-wardrobe-panel-dots" aria-hidden="true">
            {Array.from({ length: KUN_WARDROBE_RULES.dailyCap }, (_, index) => <i key={index} data-on={index < today || undefined} />)}</span></div>
        <p data-tone={today > 0 && settings.drops ? 'done' : 'next'}>{today > 0 && settings.drops ? <Check size={12} aria-hidden="true" /> : null}{status}</p>
        <RoomWardrobeShelf wardrobe={wardrobe} busy={busy || opener.opening} onOpenOne={() => opener.openOne()} onOpenTen={opener.openTen} />
      </div>
    </section>
    <nav className="rooms-wardrobe-panel-tabs" aria-label={t('roomsWardrobeTitle')}>
      {TABS.map((entry) => <button key={entry.id} type="button" aria-pressed={tab === entry.id} data-wardrobe-tab={entry.id}
        onClick={() => { setTab(entry.id); setSelection(null) }}>{t(entry.label)}
        {entry.id === 'items' && tab !== 'items' && Object.keys(wardrobe.items).some((key) => !wardrobe.seen.includes(key)) ? <i aria-hidden="true" /> : null}
      </button>)}
    </nav>
    <div className="rooms-wardrobe-panel-body">
      {tab === 'items' ? <WardrobeItemsSection wardrobe={wardrobe} language={language} category={category} ownedOnly={ownedOnly}
        selection={selection} onCategory={(value) => { setCategory(value); setSelection(null) }} onOwnedOnly={setOwnedOnly} onSelect={setSelection} />
        : tab === 'cards' ? <WardrobeCardsSection wardrobe={wardrobe} language={language} selection={selection} onSelect={setSelection} />
          : tab === 'log' ? <WardrobeLogSection wardrobe={wardrobe} language={language} />
            : <WardrobeSettingsSection settings={settings} busy={busy} onChange={(patch) => void saveSettings(patch)} />}
    </div>
    {notice || error ? <p className={error ? 'rooms-run-error rooms-wardrobe-panel-status' : 'rooms-wardrobe-panel-status'}
      role={error ? 'alert' : 'status'}>{error || notice}</p> : null}
    {sheet ? <div className="rooms-wardrobe-panel-sheet rooms-wardrobe-rarity" data-rarity={sheet.rarity} data-locked={sheet.locked || undefined}>
      <span className="rooms-wardrobe-panel-sheet-art">{sheet.art}</span>
      <span><strong>{sheet.title}</strong><small>{sheet.text}</small></span>
      <button type="button" className="rooms-run-primary" disabled={!sheet.enabled || busy} onClick={() => void sheet.run()}>{sheet.action}</button>
    </div> : null}
    {opener.overlay}
    {dressing ? <RoomUserAvatarEditor onClose={() => setDressing(false)} /> : null}
  </div>
}
