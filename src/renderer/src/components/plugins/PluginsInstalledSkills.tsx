import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { ArrowUp, FolderOpen, Loader2, RefreshCw, Search } from 'lucide-react'
import { PluginAvatar, PluginBadge, PluginPager, PluginSwitch, pluginButton } from './PluginPrimitives'
import { paginate } from './plugin-pagination'
import { matchesQuery } from './plugin-taxonomy'
import type { InstalledSkillRow } from './plugin-installed'

type Translate = (key: string, values?: Record<string, unknown>) => string
type SkillFilter = 'all' | 'enabled' | 'disabled' | 'updates'

const PAGE_SIZE = 20

export function PluginsInstalledSkills({
  t,
  rows,
  groupLabel,
  loading,
  error,
  toggleBusyId,
  updatingId,
  onRefresh,
  onToggle,
  onUpdate,
  onUpdateAll,
  onOpenFolder,
  onDiscover
}: {
  t: Translate
  rows: InstalledSkillRow[]
  groupLabel: (rootPath: string, readOnly: boolean) => string
  loading: boolean
  error: string
  toggleBusyId: string | null
  updatingId: string | null
  onRefresh: () => void
  onToggle: (row: InstalledSkillRow, enabled: boolean) => void
  onUpdate: (row: InstalledSkillRow) => void
  onUpdateAll: () => void
  onOpenFolder: (row: InstalledSkillRow) => void
  onDiscover: () => void
}): ReactElement {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SkillFilter>('all')
  const [pageNumber, setPageNumber] = useState(1)
  useEffect(() => setPageNumber(1), [query, filter, rows.length])

  const counts = useMemo(() => ({
    all: rows.length,
    enabled: rows.filter((row) => row.enabled).length,
    disabled: rows.filter((row) => !row.enabled).length,
    updates: rows.filter((row) => row.canUpdate).length
  }), [rows])
  const filtered = rows.filter((row) =>
    (filter === 'all' || (filter === 'enabled' && row.enabled) || (filter === 'disabled' && !row.enabled) || (filter === 'updates' && row.canUpdate)) &&
    matchesQuery([row.id, row.name, row.description, row.market?.label], query)
  )
  const page = paginate(filtered, pageNumber, PAGE_SIZE)
  const groups: Array<{ key: string; label: string; rows: InstalledSkillRow[] }> = []
  for (const row of page.items) {
    const key = row.readOnly ? '__builtin' : row.rootPath
    let group = groups.find((entry) => entry.key === key)
    if (!group) {
      group = { key, label: groupLabel(row.rootPath, row.readOnly), rows: [] }
      groups.push(group)
    }
    group.rows.push(row)
  }
  const segment = (active: boolean): string =>
    `inline-flex h-[30px] items-center rounded-lg px-3 text-[12.5px] transition ${active ? 'bg-ds-card font-semibold text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'}`
  const labels: Record<SkillFilter, string> = {
    all: t('pluginsFilterAll'),
    enabled: t('pluginsFilterEnabled'),
    disabled: t('pluginsFilterDisabled'),
    updates: t('pluginsFilterUpdates')
  }

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      {counts.updates > 0 ? (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl bg-accent-soft px-3.5 py-2.5 text-[12.5px] text-[#2b44b8] dark:text-[#b7c4ff]">
          <ArrowUp className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{t('pluginsUpdatesBanner', { count: counts.updates })}</span>
          <button type="button" disabled={updatingId !== null} className={`${pluginButton.small} border border-ds-border bg-ds-card text-ds-ink hover:bg-ds-hover`} onClick={onUpdateAll}>
            {updatingId === '*' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('pluginsUpdateAll')}
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-9 min-w-0 flex-[1_1_220px] items-center gap-2 rounded-[11px] border border-ds-border bg-ds-card px-3 text-ds-muted focus-within:border-[#6f8bff]">
          <Search className="h-4 w-4 shrink-0" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('pluginsSearchInstalledSkill')} aria-label={t('pluginsSearchInstalledSkill')} className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ds-ink outline-none focus-visible:outline-none" />
        </label>
        <div className="inline-flex flex-wrap rounded-[10px] bg-ds-subtle p-[3px]" role="group" aria-label={t('pluginsStatusFilter')}>
          {(['all', 'enabled', 'disabled', 'updates'] as SkillFilter[]).map((value) => (
            <button key={value} type="button" aria-pressed={filter === value} className={segment(filter === value)} onClick={() => setFilter(value)}>
              {labels[value]} {counts[value]}
            </button>
          ))}
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} aria-label={t('pluginsRefreshSkills')} title={t('pluginsRefreshSkills')} className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>
      {error ? <div role="alert" className="rounded-[10px] border border-[#f5cdc8] bg-[#fff6f5] px-3 py-2 text-[12.5px] text-[#9f2e26] dark:border-[#5a2a26] dark:bg-[#2c1a18] dark:text-[#ffaaa3]">{error}</div> : null}
      {rows.length === 0 && !loading ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-ds-subtle px-6 py-12 text-center">
          <div className="text-[14px] font-semibold text-ds-ink">{t('pluginsSkillsEmpty')}</div>
          <button type="button" className={pluginButton.dark} onClick={onDiscover}>{t('pluginsGoDiscover')}</button>
        </div>
      ) : page.total === 0 ? (
        <div className="rounded-2xl bg-ds-subtle px-6 py-10 text-center text-[13px] text-ds-muted">{t('pluginsEmptyFilterTitle')}</div>
      ) : (
        groups.map((group) => (
          <section key={group.key}>
            <h2 className="mx-0.5 mb-2 mt-1 truncate text-[12px] font-semibold tracking-wide text-ds-muted" title={group.label}>{group.label}</h2>
            <div className="rounded-[14px] border border-ds-border bg-ds-card">
              {group.rows.map((row, index) => (
                <div key={`${row.skillDir}`} className={`flex items-center gap-3 px-3.5 py-[11px] ${index > 0 ? 'border-t border-ds-border-muted' : ''}`}>
                  <PluginAvatar id={row.id} title={row.name} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[13.5px] font-semibold text-ds-ink" title={row.name}>{row.name}</span>
                      {row.market ? <PluginBadge tone="market">{row.market.label}</PluginBadge>
                        : row.readOnly ? <PluginBadge tone="kun">{t('pluginsSourceBuiltin')}</PluginBadge>
                          : <PluginBadge tone="muted">{t('pluginsSourceMine')}</PluginBadge>}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-ds-muted" title={row.description}>{row.description || row.id}</div>
                  </div>
                  {row.market?.version ? (
                    <span className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-ds-muted">
                      {row.canUpdate && row.latestVersion ? t('pluginsVersionUpdate', { from: row.market.version, to: row.latestVersion }) : `v${row.market.version}`}
                    </span>
                  ) : null}
                  {row.canUpdate ? (
                    <button type="button" disabled={updatingId !== null} className={`${pluginButton.small} ${pluginButton.up}`} onClick={() => onUpdate(row)}>
                      {updatingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {t('pluginsActionUpdate')}
                    </button>
                  ) : null}
                  <PluginSwitch tone="skill" checked={row.enabled} disabled={toggleBusyId === row.id} label={t('pluginsEnableToggle', { name: row.name })} onChange={(enabled) => onToggle(row, enabled)} />
                  <button type="button" aria-label={t('pluginsOpenFolder', { name: row.name })} title={t('pluginsOpenFolder', { name: row.name })} onClick={() => onOpenFolder(row)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
                    <FolderOpen className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
      <PluginPager t={t} page={page.page} pageCount={page.pageCount} start={page.start} end={page.end} total={page.total} pageSize={PAGE_SIZE} onPage={setPageNumber} />
    </div>
  )
}
