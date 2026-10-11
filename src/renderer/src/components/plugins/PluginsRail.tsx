import type { ReactElement } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { PluginBadge, type BadgeTone } from './PluginPrimitives'
import type { CategoryOption } from './plugin-taxonomy'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type RailOption = { id: string; label: string; count: number }

export type RailSync = { text: string; tone: 'muted' | 'warn' | 'error'; syncing: boolean }

export type PluginsRailProps = {
  t: Translate
  compact: boolean
  view: 'installed' | 'discover'
  installedCount: number
  installedBadge?: { tone: BadgeTone; label: string }
  onInstalled: () => void
  sources: RailOption[]
  source: string
  onSource: (id: string) => void
  categories: CategoryOption[]
  categoryTotal: number
  category: string
  onCategory: (id: string) => void
  locations?: RailOption[]
  location: string
  onLocation: (id: string) => void
  sync: RailSync | null
  onRefresh: () => void
}

function NavButton({ active, label, count, badge, onClick }: {
  active: boolean
  label: string
  count?: number
  badge?: { tone: BadgeTone; label: string }
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      className={`flex h-[34px] w-full items-center gap-2 rounded-[9px] px-2.5 text-left text-[13px] text-ds-ink transition ${active ? 'bg-ds-hover font-semibold' : 'hover:bg-ds-subtle'}`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? <PluginBadge tone={badge.tone}>{badge.label}</PluginBadge> : null}
      {count !== undefined ? <span className="text-[12px] tabular-nums text-ds-muted">{count}</span> : null}
    </button>
  )
}

function SyncBox({ t, sync, onRefresh, compact }: { t: Translate; sync: RailSync; onRefresh: () => void; compact?: boolean }): ReactElement {
  const tone = sync.tone === 'error' ? 'text-ds-danger' : sync.tone === 'warn' ? 'text-[#8a4b00] dark:text-[#ffc985]' : 'text-ds-muted'
  const box = sync.tone === 'warn' ? 'bg-[#fffaf2] dark:bg-[#2c2416]' : 'bg-ds-subtle'
  return (
    <div className={`flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-[12px] leading-[1.45] ${box} ${compact ? '' : 'mt-[18px]'}`}>
      <span className={`min-w-0 flex-1 break-words ${tone}`}>{sync.text}</span>
      <button type="button" onClick={onRefresh} disabled={sync.syncing} aria-label={t('pluginsRefreshMarkets')} title={t('pluginsRefreshMarkets')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-60">
        {sync.syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

const LABEL = 'px-2.5 pb-1.5 pt-4 text-[11px] font-semibold tracking-wide text-ds-muted'

export function PluginsRail(props: PluginsRailProps): ReactElement {
  const { t } = props
  if (props.compact) return <PluginsRailCompact {...props} />
  return (
    <aside aria-label={t('pluginsFilters')} className="flex w-[210px] shrink-0 flex-col gap-0.5">
      <NavButton active={props.view === 'installed'} label={t('pluginsInstalled')} count={props.installedCount} badge={props.installedBadge} onClick={props.onInstalled} />
      {props.view === 'installed' && props.locations ? (
        <>
          <div className={LABEL}>{t('pluginsLocations')}</div>
          {props.locations.map((option) => (
            <NavButton key={option.id} active={props.location === option.id} label={option.label} count={option.count} onClick={() => props.onLocation(option.id)} />
          ))}
        </>
      ) : null}
      <div className={LABEL}>{t('pluginsDiscover')}</div>
      {props.sources.map((option) => (
        <NavButton key={option.id} active={props.view === 'discover' && props.source === option.id} label={option.label} count={option.count} onClick={() => props.onSource(option.id)} />
      ))}
      {props.view === 'discover' && props.categories.length > 0 ? (
        <>
          <div className={LABEL}>{t('pluginsCategories')}</div>
          <NavButton active={props.category === 'all'} label={t('pluginsCategoryAll')} count={props.categoryTotal} onClick={() => props.onCategory('all')} />
          {props.categories.map((option) => (
            <NavButton key={option.id} active={props.category === option.id} label={option.label} count={option.count} onClick={() => props.onCategory(option.id)} />
          ))}
        </>
      ) : null}
      {props.sync ? <SyncBox t={t} sync={props.sync} onRefresh={props.onRefresh} /> : null}
    </aside>
  )
}

function PluginsRailCompact(props: PluginsRailProps): ReactElement {
  const { t } = props
  const segment = (active: boolean): string =>
    `inline-flex h-[30px] items-center gap-1.5 rounded-lg px-3 text-[12.5px] transition ${active ? 'bg-ds-card font-semibold text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'}`
  const select = 'h-[34px] rounded-[10px] border border-ds-border bg-ds-card px-2.5 text-[12.5px] text-ds-ink outline-none focus-visible:outline-none focus:border-[#6f8bff]'
  const chip = (active: boolean): string =>
    `h-7 shrink-0 rounded-full border px-3 text-[12px] transition ${active ? 'border-ds-ink bg-ds-ink text-white dark:text-ds-main' : 'border-ds-border bg-ds-card text-ds-muted hover:text-ds-ink'}`
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-[10px] bg-ds-subtle p-[3px]" role="group" aria-label={t('pluginsFilters')}>
          <button type="button" className={segment(props.view === 'installed')} onClick={props.onInstalled}>
            {t('pluginsInstalled')} {props.installedCount}
            {props.installedBadge ? <PluginBadge tone={props.installedBadge.tone}>{props.installedBadge.label}</PluginBadge> : null}
          </button>
          <button type="button" className={segment(props.view === 'discover')} onClick={() => props.onSource(props.source)}>
            {t('pluginsDiscover')}
          </button>
        </div>
        {props.view === 'discover' ? (
          <select aria-label={t('pluginsDiscover')} className={select} value={props.source} onChange={(event) => props.onSource(event.target.value)}>
            {props.sources.map((option) => <option key={option.id} value={option.id}>{option.label} {option.count}</option>)}
          </select>
        ) : props.locations ? (
          <select aria-label={t('pluginsLocations')} className={select} value={props.location} onChange={(event) => props.onLocation(event.target.value)}>
            {props.locations.map((option) => <option key={option.id} value={option.id}>{option.label} {option.count}</option>)}
          </select>
        ) : null}
      </div>
      {props.view === 'discover' && props.categories.length > 0 ? (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label={t('pluginsCategories')}>
          <button type="button" className={chip(props.category === 'all')} onClick={() => props.onCategory('all')}>{t('pluginsCategoryAll')} {props.categoryTotal}</button>
          {props.categories.map((option) => (
            <button key={option.id} type="button" className={chip(props.category === option.id)} onClick={() => props.onCategory(option.id)}>{option.label} {option.count}</button>
          ))}
        </div>
      ) : null}
      {props.sync && props.sync.tone !== 'muted' ? <SyncBox t={t} sync={props.sync} onRefresh={props.onRefresh} compact /> : null}
    </div>
  )
}
