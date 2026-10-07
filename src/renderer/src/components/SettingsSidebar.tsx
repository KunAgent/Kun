import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, ReactElement, SetStateAction } from 'react'
import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, Search, SearchX, X } from 'lucide-react'
import kunLogo from '../../../asset/img/kun.png'
import { SettingsIconTile } from './settings-icon-tile'
import {
  filterSettingsNavigationGroups,
  settingsNavigationLabel,
  visibleSettingsNavigationGroups,
  type SettingsCategory
} from './settings-navigation'

export {
  settingsCategoryDescriptionKey,
  settingsCategoryLabelKey,
  type SettingsCategory
} from './settings-navigation'

const CATEGORY_SELECTOR = 'button[data-settings-category]'

/** Moves focus between visible destinations without changing the selection. */
function focusSibling(nav: HTMLElement | null, from: Element | null, step: 1 | -1 | 'first' | 'last'): boolean {
  if (!nav) return false
  const items = [...nav.querySelectorAll<HTMLButtonElement>(CATEGORY_SELECTOR)]
  if (items.length === 0) return false
  const index = from ? items.indexOf(from as HTMLButtonElement) : -1
  const next = step === 'first'
    ? items[0]
    : step === 'last'
      ? items[items.length - 1]
      : items[(index + step + items.length) % items.length]
  next?.focus()
  return Boolean(next)
}

export function SettingsSidebar({
  category,
  goBack,
  setCategory,
  extensionSettingsAvailable = false,
  platform = 'unknown',
  onPreloadCategory,
  t
}: {
  category: SettingsCategory
  goBack: () => void
  setCategory: Dispatch<SetStateAction<SettingsCategory>>
  extensionSettingsAvailable?: boolean
  platform?: string
  /** Warms a destination's code before it is opened (hover, focus, search match). */
  onPreloadCategory?: (category: SettingsCategory) => void
  t: (key: string) => string
}): ReactElement {
  const [query, setQuery] = useState('')
  const navRef = useRef<HTMLElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const groups = useMemo(
    () => visibleSettingsNavigationGroups({ extensionSettingsAvailable, platform }),
    [extensionSettingsAvailable, platform]
  )
  const filteredGroups = useMemo(() => filterSettingsNavigationGroups(groups, query, t), [groups, query, t])
  const searching = query.trim().length > 0
  const firstMatch = filteredGroups[0]?.items[0]

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    // Enter/Esc/arrows also confirm or cancel IME candidates (pinyin, kana, hangul).
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter' && searching && firstMatch) {
      event.preventDefault()
      setCategory(firstMatch.category)
    } else if (event.key === 'ArrowDown') {
      if (focusSibling(navRef.current, null, 'first')) event.preventDefault()
    } else if (event.key === 'Escape' && query) {
      event.preventDefault()
      event.stopPropagation()
      setQuery('')
    }
  }

  const onNavKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const target = event.target as Element
    if (!target.matches(CATEGORY_SELECTOR)) return
    const nav = navRef.current
    const items = nav ? [...nav.querySelectorAll(CATEGORY_SELECTOR)] : []
    let moved = false
    if (event.key === 'ArrowDown') moved = focusSibling(nav, target, 1)
    else if (event.key === 'ArrowUp') {
      if (items.indexOf(target) === 0 && searchRef.current) {
        searchRef.current.focus()
        moved = true
      } else moved = focusSibling(nav, target, -1)
    } else if (event.key === 'Home') moved = focusSibling(nav, target, 'first')
    else if (event.key === 'End') moved = focusSibling(nav, target, 'last')
    if (moved) event.preventDefault()
  }

  return (
    <aside className="ds-settings-sidebar ds-drag flex h-full min-h-0 shrink-0 flex-col">
      <div className="ds-settings-sidebar-header shrink-0">
        <div aria-hidden className="ds-titlebar-safe-block" />
        <div className="ds-settings-sidebar-heading flex items-center gap-1.5">
          <button
            type="button"
            aria-label={t('back')}
            title={t('back')}
            data-cursor-spotlight-target
            onClick={goBack}
            className="ds-settings-back ds-no-drag"
          >
            <ChevronLeft aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
          <h1 className="ds-settings-sidebar-title min-w-0 truncate">{t('title')}</h1>
        </div>
        <div className="ds-settings-search ds-no-drag" role="search">
          <Search aria-hidden="true" className="ds-settings-search-icon" strokeWidth={2} />
          <input
            ref={searchRef}
            type="text"
            inputMode="search"
            enterKeyHint="go"
            spellCheck={false}
            autoComplete="off"
            aria-label={t('settingsSearchPlaceholder')}
            aria-controls="settings-navigation"
            placeholder={t('settingsSearchPlaceholder')}
            value={query}
            onChange={(event) => {
              const next = event.target.value
              setQuery(next)
              const match = filterSettingsNavigationGroups(groups, next, t)[0]?.items[0]
              if (match && next.trim()) onPreloadCategory?.(match.category)
            }}
            onKeyDown={onSearchKeyDown}
          />
          {query ? (
            <button
              type="button"
              className="ds-settings-search-clear"
              aria-label={t('settingsSearchClear')}
              title={t('settingsSearchClear')}
              onClick={() => {
                setQuery('')
                searchRef.current?.focus()
              }}
            >
              <span aria-hidden="true" className="ds-settings-search-clear-glyph">
                <X className="h-2.5 w-2.5" strokeWidth={2.8} />
              </span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="ds-settings-compact-navigation ds-no-drag">
        <select
          aria-label={t('title')}
          value={category}
          onChange={(event) => setCategory(event.target.value as SettingsCategory)}
        >
          {groups.map((group) => (
            <optgroup key={group.id} label={t(group.labelKey)}>
              {group.items.map((item) => (
                <option key={item.category} value={item.category}>{t(item.labelKey)}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <nav
        ref={navRef}
        id="settings-navigation"
        aria-label={t('title')}
        className="ds-settings-nav ds-no-drag min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-searching={searching ? 'true' : undefined}
        onKeyDown={onNavKeyDown}
      >
        {filteredGroups.map((group) => {
          const headingId = `settings-nav-group-${group.id}`
          return (
            <section key={group.id} aria-labelledby={headingId} className="ds-settings-nav-group">
              <h2 id={headingId} className="ds-settings-nav-heading">
                {t(group.labelKey)}
              </h2>
              <div className="ds-settings-nav-items">
                {group.items.map((item) => {
                  const selected = category === item.category
                  const fullLabel = t(item.labelKey)
                  return (
                    <button
                      key={item.category}
                      type="button"
                      aria-label={fullLabel}
                      aria-current={selected ? 'page' : undefined}
                      title={fullLabel}
                      data-settings-category={item.category}
                      data-cursor-spotlight-target
                      className="ds-settings-nav-item group"
                      onPointerEnter={() => onPreloadCategory?.(item.category)}
                      onFocus={() => onPreloadCategory?.(item.category)}
                      onClick={() => setCategory(item.category)}
                    >
                      <SettingsIconTile icon={item.icon} tone={item.tone} active={selected} />
                      <span className="min-w-0 flex-1 truncate">{settingsNavigationLabel(item, t)}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
        {filteredGroups.length === 0 ? (
          <div role="status" className="ds-settings-nav-empty">
            <SearchX aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
            <span>{t('settingsSearchEmpty')}</span>
          </div>
        ) : null}
      </nav>

      <div className="ds-settings-sidebar-footer ds-no-drag shrink-0">
        <img src={kunLogo} alt="" aria-hidden="true" draggable={false} className="ds-settings-sidebar-logo" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium leading-4 text-ds-ink">Kun</div>
          <div className="truncate text-[11px] leading-4 text-ds-faint">{t('settingsFooter')}</div>
        </div>
      </div>
    </aside>
  )
}
