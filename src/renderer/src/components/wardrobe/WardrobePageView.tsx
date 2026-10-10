import { useArtRevision } from '../rooms/art-asset-store'
import { WardrobeArtUpdates } from './WardrobeArtUpdates'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Dices, Feather, Lock, RotateCcw, Settings2, Upload, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  KUN_AVATAR_CATALOG, KUN_AVATAR_PRESETS, kunWardrobeProgress, normalizeKunAvatarParts, randomKunAvatarParts,
  type KunAvatarAccessoryCategory, type KunAvatarParts, type KunWardrobeSettings
} from '@shared/rooms-api'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { WardrobeLogSection, WardrobeSettingsSection } from '../rooms/RoomWardrobePanelSections'
import { useWardrobeOpener } from '../rooms/RoomWardrobeOpening'
import {
  requireKunAppearanceLogin, WardrobeAccountError, exchangeWardrobeItem, markWardrobeSeen, updateWardrobeSettings, useWardrobe, wardrobeSettings
} from '../rooms/room-wardrobe'
import { wearDropOnMe } from '../rooms/room-wardrobe-wear'
import { useRoomUserProfile, useRoomUserProfileSync } from '../rooms/room-user-profile'
import { createWardrobeLookSaver } from './wardrobe-look-saver'
import {
  composedAvatar, toggleWardrobeItem, wardrobeLook, wardrobeOwns, wardrobeRoleCards, wardrobeUnseen,
  type WardrobeAvatar, type WardrobeCardFilter, type WardrobeCategory, type WardrobeSelection, type WardrobeTile
} from './wardrobe-page-model'
import { WardrobeCardsSection, WardrobeItemsSection } from './WardrobeCollection'
import { WardrobeInspector } from './WardrobeInspector'
import { WardrobeLookPanel } from './WardrobeLookPanel'
import { WardrobePhotoDialog, readWardrobePhoto } from './WardrobePhotoDialog'
import { WardrobeShelfCard } from './WardrobeShelfCard'
import { WardrobeGuestCard, WardrobeLockedPanel } from './WardrobeGuest'
import { WardrobeInvitePanel } from './WardrobeInvitePanel'
import { WardrobeShopPanel } from './WardrobeShopPanel'
import { wardrobeErrorText } from './wardrobe-account'
import { WARDROBE_SLOT_LABELS, WardrobeStage } from './WardrobeStage'
import { useWardrobeTabRequest } from './wardrobe-tab-request'
import '../rooms/room-avatar-composer.css'
import '../rooms/room-wardrobe.css'
import '../rooms/room-wardrobe-panel.css'
import '../rooms/room-wardrobe-holo.css'
import './wardrobe-page.css'
import './wardrobe-account.css'

type Tab = 'items' | 'cards' | 'look' | 'log' | 'shop' | 'invite'
const TAB_LABELS = { items: 'wardrobePageTabItems', cards: 'wardrobePageTabCards', look: 'wardrobePageTabLook', log: 'wardrobePageTabLog',
  shop: 'wardrobeAccountTabShop', invite: 'wardrobeAccountTabInvite' } as const
/** Shop and invitations belong to the Kun account; a debug run's local game has neither. */
const ACCOUNT_TABS: Tab[] = ['shop', 'invite']
type Toast = { text: string; undo?: { avatar: WardrobeAvatar }; error?: boolean }

/**
 * My wardrobe as a full page: the fitting room and the bottle shelf on the left, the collection
 * on the right. Wearing applies at once and syncs to every conversation; the toast can undo it.
 */
export function WardrobePageView({ leftSidebarCollapsed, onToggleLeftSidebar, onClose }: {
  leftSidebarCollapsed: boolean; onToggleLeftSidebar: () => void
  /** Leaves the page for where the user came from; the account menu no longer toggles it. */
  onClose?: () => void
}): ReactElement {
  useArtRevision()
  const { t, i18n } = useTranslation('common')
  const language = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const state = useWardrobe()
  useRoomUserProfileSync()
  const profileAvatar = useRoomUserProfile((value) => value.profile.avatar)
  const [optimistic, setOptimistic] = useState<{ avatar: WardrobeAvatar } | null>(null)
  const avatar = state.mode === 'guest' ? null : optimistic ? optimistic.avatar : profileAvatar
  const { parts, dressed } = wardrobeLook(avatar)
  const tabRequest = useWardrobeTabRequest((value) => value.request)
  const [tab, setTab] = useState<Tab>(() => tabRequest?.tab ?? 'items')
  const [category, setCategory] = useState<WardrobeCategory>('all')
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [cardFilter, setCardFilter] = useState<WardrobeCardFilter>('all')
  const [selection, setSelection] = useState<WardrobeSelection>(null)
  const [trying, setTrying] = useState<KunAvatarParts | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState<ImageBitmap | null>(null)
  const title = useRef<HTMLHeadingElement>(null), popover = useRef<HTMLDivElement>(null), gear = useRef<HTMLButtonElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const failed = useRef(''); failed.current = t('wardrobePageSaveFailed')
  const [saver] = useState(() => createWardrobeLookSaver({
    onIdle: () => setOptimistic(null),
    onError: () => { setOptimistic(null); setToast({ text: failed.current, error: true }) }
  }))
  const opener = useWardrobeOpener({ onWear: wearDropOnMe, onDress: () => setTab('items') })
  const wardrobe = state.wardrobe
  const unlockAll = state.unlockAll
  const guest = state.mode === 'guest'
  const tabs: Tab[] = ['items', 'cards', 'look', 'log', ...(state.mode === 'local' ? [] : ACCOUNT_TABS)]

  useEffect(() => { if (guest) { setOptimistic(null); setTrying(null); setPhoto(null); setToast(null) } }, [guest])
  // The account menu can ask for a tab while the page is already open; a tab this mode lacks falls back to items.
  const requestedTab = tabRequest?.tab
  const requestSerial = tabRequest?.serial
  useEffect(() => {
    if (!requestedTab) return
    setTab(tabs.includes(requestedTab) ? requestedTab : 'items')
    setSelection(null)
    setTrying(null)
  }, [requestSerial]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { title.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.error ? 6000 : 4000)
    return () => clearTimeout(timer)
  }, [toast])
  // New marks fade once their shelf has been on screen for a moment.
  useEffect(() => {
    if (tab !== 'items' && tab !== 'cards') return
    const unseen = wardrobeUnseen(wardrobe, tab)
    if (!unseen.length) return
    const timer = setTimeout(() => void markWardrobeSeen(unseen).catch(() => undefined), 2500)
    return () => clearTimeout(timer)
  }, [tab, wardrobe])
  useEffect(() => {
    if (!settingsOpen) return
    const away = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && !popover.current?.contains(target) && !gear.current?.contains(target)) setSettingsOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSettingsOpen(false); gear.current?.focus() } }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape) }
  }, [settingsOpen])

  const choose = (next: WardrobeAvatar, text: string) => {
    if (!requireKunAppearanceLogin()) return
    setToast({ text, undo: { avatar } })
    setOptimistic({ avatar: next })
    setTrying(null)
    saver.save(next)
  }
  const undo = (previous: WardrobeAvatar) => {
    if (!requireKunAppearanceLogin()) return
    setToast(null)
    setOptimistic({ avatar: previous })
    saver.save(previous)
  }
  const wearItem = (slot: KunAvatarAccessoryCategory, id: string, worn: boolean) => {
    const name = KUN_AVATAR_CATALOG[slot].find((entry) => entry.id === id)?.label[language] ?? id
    const result = toggleWardrobeItem(parts, slot, id, worn)
    const removed = result.removed.length ? ` · ${t('roomsAvatarConflictsRemoved', { parts: result.removed.map((part) => t(WARDROBE_SLOT_LABELS[part])).join('、') })}` : ''
    choose(composedAvatar(result.parts), `${t(worn ? 'wardrobePageToastTakeOff' : 'wardrobePageToastWear', { name })}${removed}`)
  }
  const wearTile = (tile: WardrobeTile, worn: boolean) => {
    setSelection({ kind: 'item', key: tile.key })
    wearItem(tile.category, tile.id, worn)
  }
  const randomize = () => {
    const owns = (slot: KunAvatarAccessoryCategory, id: string) => wardrobeOwns(wardrobe, unlockAll, `${slot}/${id}`) > 0
    choose(composedAvatar({ ...randomKunAvatarParts(Math.random, owns), bg: parts.bg }), t('wardrobePageToastRandom'))
  }
  const run = async (work: () => Promise<void>, done?: string) => {
    setBusy(true)
    try { await work(); if (done) setToast({ text: done }) } catch (cause) {
      setToast({ text: cause instanceof WardrobeAccountError ? wardrobeErrorText(t, cause) : String(cause), error: true })
    } finally { setBusy(false) }
  }
  const choosePhoto = async (selected: File) => {
    if (!requireKunAppearanceLogin()) return
    try { setPhoto(await readWardrobePhoto(selected)) } catch { setToast({ text: t('roomsAvatarInvalidFile'), error: true }) }
  }
  const progress = wardrobe ? kunWardrobeProgress(wardrobe) : null
  const cards = wardrobeRoleCards(wardrobe, unlockAll)
  const counts: Record<Tab, string> = {
    items: progress ? `${unlockAll ? progress.totalItems : progress.ownedItems}/${progress.totalItems}` : '',
    cards: `${cards.filter((card) => card.lit).length}/${cards.length}`, look: '', log: '', shop: '', invite: ''
  }
  return <div className="kun-wardrobe ds-drag flex h-full min-h-0 flex-col bg-ds-main" data-wardrobe-page>
    <div className="ds-stage-inset shrink-0">
      <header className="ds-topbar-surface relative z-10 mt-3 flex min-h-[46px] w-full items-stretch overflow-visible rounded-[24px]">
        <div className="kun-wardrobe-head">
          <div className={`kun-wardrobe-head-title ${leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''}`}>
            <SidebarTitlebarToggleButton onClick={onToggleLeftSidebar}
              title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')} ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')} />
            <h1 ref={title} tabIndex={-1}>{t('roomsWardrobeMine')}</h1>
            {state.mode === 'local' ? <span className="kun-wardrobe-head-hint">{t('roomsWardrobeMineHint')}</span>
              : <span className="kun-wardrobe-account-chip" data-mode={state.mode} data-wardrobe-mode={state.mode}>
                <i aria-hidden="true" />{t(guest ? 'wardrobeAccountGuestChip' : 'wardrobeAccountSynced')}</span>}
          </div>
          <div className="kun-wardrobe-head-actions ds-no-drag">
            {wardrobe && !guest ? <span className="kun-wardrobe-feathers" title={t('wardrobePageFeathersHint')} data-wardrobe-feathers={wardrobe.feathers}>
              <Feather size={14} strokeWidth={2} aria-hidden="true" />{t('wardrobePageFeathers', { n: wardrobe.feathers })}</span> : null}
            {guest ? null : <button type="button" ref={gear} className="kun-wardrobe-head-icon" aria-label={t('wardrobePageDropSettings')} title={t('wardrobePageDropSettings')}
              aria-expanded={settingsOpen} aria-pressed={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)} data-wardrobe-settings>
              <Settings2 size={16} strokeWidth={1.8} aria-hidden="true" /></button>}
            {onClose ? <button type="button" className="kun-wardrobe-head-icon" aria-label={t('wardrobePageLeave')} title={t('wardrobePageLeave')}
              onClick={onClose} data-wardrobe-close><X size={16} strokeWidth={1.8} aria-hidden="true" /></button> : null}
            {settingsOpen && wardrobe ? <div ref={popover} className="kun-wardrobe-popover" role="dialog" aria-label={t('wardrobePageDropSettings')}>
              <div className="kun-wardrobe-popover-head"><strong>{t('wardrobePageDropSettings')}</strong>
                <button type="button" onClick={() => setSettingsOpen(false)} aria-label={t('wardrobePageClose')}><X size={15} aria-hidden="true" /></button></div>
              <WardrobeSettingsSection settings={wardrobeSettings(wardrobe)} busy={busy}
                onChange={(patch: Partial<KunWardrobeSettings>) => void run(() => updateWardrobeSettings(patch))} />
            </div> : null}
          </div>
        </div>
      </header>
    </div>
    <WardrobeArtUpdates language={language} />
    {!wardrobe ? <p className={state.error ? 'kun-wardrobe-empty rooms-run-error' : 'kun-wardrobe-empty'} role={state.error ? 'alert' : undefined}>
      {state.error || t('roomsLoading')}</p> : <main className="kun-wardrobe-body ds-no-drag">
      <div className="kun-wardrobe-side">
        <WardrobeStage avatar={avatar} parts={parts} dressed={dressed} trying={trying} language={language}
          notice={toast ? <div className="kun-wardrobe-toast" role={toast.error ? 'alert' : 'status'} data-error={toast.error || undefined}
            title={toast.error ? undefined : t('wardrobePageSynced')}>
            <span>{toast.text}</span>
            {toast.undo ? <button type="button" onClick={() => undo(toast.undo!.avatar)} data-wardrobe-undo>{t('wardrobePageUndo')}</button> : null}
          </div> : null}
          onSlot={(slot) => {
            setTab('items'); setCategory(slot)
            setSelection(dressed && parts[slot] ? { kind: 'item', key: `${slot}/${parts[slot]}` } : null)
          }}
          onRemove={(slot) => { const id = parts[slot]; if (id) wearItem(slot, id, true) }} />
        <div className="kun-wardrobe-actions">
          <button type="button" onClick={randomize} data-wardrobe-random><Dices size={15} strokeWidth={1.8} aria-hidden="true" />{t('roomsAvatarRandom')}</button>
          <button type="button" onClick={() => choose(null, t('wardrobePageToastRestore'))} data-wardrobe-restore>
            <RotateCcw size={15} strokeWidth={1.8} aria-hidden="true" />{t('wardrobePageRestore')}</button>
          <button type="button" onClick={() => { if (requireKunAppearanceLogin()) file.current?.click() }} data-wardrobe-upload>
            <Upload size={15} strokeWidth={1.8} aria-hidden="true" />{t('roomsAvatarUpload')}</button>
        </div>
        {guest ? <WardrobeGuestCard />
          : <WardrobeShelfCard wardrobe={wardrobe} busy={opener.opening} onOpenOne={() => opener.openOne()} onOpenTen={opener.openTen} />}
      </div>
      <section className="kun-wardrobe-collection" aria-label={t('roomsWardrobeTitle')}>
        <nav className="kun-wardrobe-tabs" aria-label={t('roomsWardrobeTitle')}>
          {tabs.map((id) => <button key={id} type="button" aria-pressed={tab === id} data-wardrobe-tab={id}
            onClick={() => { setTab(id); setSelection(null); setTrying(null) }}>
            {guest && ACCOUNT_TABS.includes(id) ? <Lock size={13} strokeWidth={2} aria-hidden="true" /> : null}
            {t(TAB_LABELS[id])}{counts[id] ? <span>{counts[id]}</span> : null}
            {id === 'items' && tab !== 'items' && wardrobeUnseen(wardrobe, 'items').length ? <i aria-hidden="true" /> : null}
          </button>)}
          <span className="kun-wardrobe-tabs-fill" />
          {tab === 'items' ? <label className="kun-wardrobe-owned"><input type="checkbox" checked={ownedOnly}
            onChange={(event) => { setOwnedOnly(event.target.checked); setSelection(null) }} />{t('roomsWardrobeOwnedOnly')}</label> : null}
        </nav>
        {tab === 'items' ? <WardrobeItemsSection wardrobe={wardrobe} unlockAll={unlockAll} parts={parts} dressed={dressed} language={language}
          category={category} ownedOnly={ownedOnly} selection={selection} onCategory={(value) => { setCategory(value); setSelection(null) }}
          onSelect={setSelection} onWear={wearTile} onTry={(tile) => { if (!guest) setTrying(toggleWardrobeItem(parts, tile.category, tile.id, false).parts) }}
          onEndTry={() => setTrying(null)} />
          : tab === 'cards' ? <WardrobeCardsSection wardrobe={wardrobe} unlockAll={unlockAll} language={language} filter={cardFilter}
            selection={selection} onFilter={(value) => { setCardFilter(value); setSelection(null) }} onSelect={setSelection} />
            : tab === 'look' ? <WardrobeLookPanel parts={parts} dressed={dressed} language={language}
              onPick={(next, name) => choose(composedAvatar(next), t('wardrobePageToastLook', { name }))} onTry={(next) => { if (!guest) setTrying(next) }} onEndTry={() => setTrying(null)} />
              : tab === 'log' ? <div className="kun-wardrobe-scroll kun-wardrobe-log"><WardrobeLogSection wardrobe={wardrobe} language={language} /></div>
                : guest ? <WardrobeLockedPanel kind={tab === 'shop' ? 'shop' : 'invite'} />
                  : tab === 'shop' ? <WardrobeShopPanel wardrobe={wardrobe} language={language} onBought={(text) => setToast({ text })}
                    onBrowse={() => { setTab('items'); setOwnedOnly(false); setSelection(null) }} />
                    : <WardrobeInvitePanel look={wardrobeLook(profileAvatar).parts} language={language} onClaimed={(text) => setToast({ text })} />}
        {tab === 'items' || tab === 'cards' ? <WardrobeInspector selection={selection} wardrobe={wardrobe} unlockAll={unlockAll} guest={guest} parts={parts}
          dressed={dressed} language={language} busy={busy} onWearItem={wearItem} onClose={() => setSelection(null)}
          onExchange={(key) => {
            const [slot, id] = key.split('/') as [KunAvatarAccessoryCategory, string]
            const name = KUN_AVATAR_CATALOG[slot]?.find((entry) => entry.id === id)?.label[language] ?? ''
            void run(() => exchangeWardrobeItem(key as never), t('roomsWardrobeExchanged', { item: name }))
          }}
          onWearSet={(presetId) => {
            const preset = KUN_AVATAR_PRESETS.find((entry) => entry.id === presetId)
            if (preset) choose(composedAvatar(normalizeKunAvatarParts({ ...preset.parts, bg: parts.bg })), t('wardrobePageToastSet', { name: preset.label[language] }))
          }} /> : null}
      </section>
    </main>}
    <input ref={file} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
      const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void choosePhoto(selected)
    }} />
    {photo ? <WardrobePhotoDialog source={photo} onClose={() => setPhoto(null)}
      onDone={(uploaded) => { setPhoto(null); choose(uploaded, t('wardrobePageToastPhoto')) }} /> : null}
    {opener.overlay}
  </div>
}
