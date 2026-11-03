import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Info, Lock, MoreHorizontal, RefreshCw, Search } from 'lucide-react'
import { PluginAvatar, PluginBadge, PluginPager, PluginSwitch, StatusPill, pluginButton, type BadgeTone, type PillTone } from './PluginPrimitives'
import { paginate } from './plugin-pagination'
import { matchesQuery } from './plugin-taxonomy'
import type { InstalledGroup, InstalledMcpRow } from './plugin-installed'

type Translate = (key: string, values?: Record<string, unknown>) => string
type StatusFilter = 'all' | InstalledGroup

const PAGE_SIZE = 20
const GROUPS: InstalledGroup[] = ['attention', 'enabled', 'disabled']

export type McpSummary = {
  services: number
  connected: number
  tools: number
  attention: number
  runtimeAvailable: boolean
  loading: boolean
}

export function mcpStatusView(t: Translate, row: Pick<InstalledMcpRow, 'status' | 'toolCount'>): { tone: PillTone; label: string } {
  switch (row.status) {
    case 'needs-config': return { tone: 'warn', label: t('pluginsStatusNeedsConfig') }
    case 'error': return { tone: 'error', label: t('pluginsStatusError') }
    case 'unauthorized': return { tone: 'off', label: t('pluginsStatusUnauthorized') }
    case 'connected': return { tone: 'ok', label: row.toolCount !== undefined ? t('pluginsStatusConnectedTools', { count: row.toolCount }) : t('pluginsStatusConnected') }
    case 'configured': return { tone: 'ok', label: t('pluginsStatusConfigured') }
    case 'disabled': return { tone: 'off', label: t('pluginsStatusDisabled') }
  }
}

export function mcpSourceBadge(t: Translate, row: Pick<InstalledMcpRow, 'source' | 'sourceLabel'>): { tone: BadgeTone; label: string } {
  switch (row.source) {
    case 'market': return { tone: 'market', label: row.sourceLabel ?? '' }
    case 'kun': return { tone: 'kun', label: t('pluginsSourceKun') }
    case 'builtin': return { tone: 'muted', label: t('pluginsSourceBuiltin') }
    case 'custom': return { tone: 'muted', label: t('pluginsSourceCustom') }
  }
}

function subLine(t: Translate, row: InstalledMcpRow): string {
  if (row.status === 'needs-config') return [t('pluginsMissingKeysLine', { keys: row.missingKeys.join(', ') }), row.launch].filter(Boolean).join(' · ')
  if (row.status === 'error' && row.lastError) return [row.lastError, row.launch].filter(Boolean).join(' · ')
  return row.description || row.launch
}

export function PluginsInstalledMcp({
  t,
  rows,
  summary,
  toggleBusyId,
  onRefreshStatus,
  onToggle,
  onConfigure,
  onDelete,
  onCopy,
  onManageBuiltin,
  onDiscover
}: {
  t: Translate
  rows: InstalledMcpRow[]
  summary: McpSummary
  toggleBusyId: string | null
  onRefreshStatus: () => void
  onToggle: (row: InstalledMcpRow, enabled: boolean) => void
  onConfigure: (row: InstalledMcpRow) => void
  onDelete: (row: InstalledMcpRow) => void
  onCopy: (row: InstalledMcpRow) => void
  onManageBuiltin: (row: InstalledMcpRow) => void
  onDiscover: () => void
}): ReactElement {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [pageNumber, setPageNumber] = useState(1)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  useEffect(() => setPageNumber(1), [query, status])

  const counts = useMemo(() => ({
    all: rows.length,
    attention: rows.filter((row) => row.group === 'attention').length,
    enabled: rows.filter((row) => row.group === 'enabled').length,
    disabled: rows.filter((row) => row.group === 'disabled').length
  }), [rows])
  const filtered = rows.filter((row) =>
    (status === 'all' || row.group === status) &&
    matchesQuery([row.id, row.title, row.description, row.launch, row.sourceLabel], query)
  )
  const page = paginate(filtered, pageNumber, PAGE_SIZE)
  const segment = (active: boolean): string =>
    `inline-flex h-[30px] items-center rounded-lg px-3 text-[12.5px] transition ${active ? 'bg-ds-card font-semibold text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'}`
  const filterLabels: Record<StatusFilter, string> = {
    all: t('pluginsFilterAll'),
    attention: t('pluginsFilterAttention'),
    enabled: t('pluginsFilterEnabled'),
    disabled: t('pluginsFilterDisabled')
  }

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-ds-border bg-ds-card px-3.5 py-3">
        {summary.runtimeAvailable ? (
          <>
            <span className="flex items-baseline gap-1"><b className="text-[16px] tabular-nums text-ds-ink">{summary.services}</b><span className="text-ds-muted">{t('pluginsSummaryServices')}</span></span>
            <span className="flex items-baseline gap-1"><b className="text-[16px] tabular-nums text-[#0f7a42] dark:text-[#8fe0b4]">{summary.connected}</b><span className="text-ds-muted">{t('pluginsSummaryConnected')}</span></span>
            <span className="flex items-baseline gap-1"><b className="text-[16px] tabular-nums text-ds-ink">{summary.tools}</b><span className="text-ds-muted">{t('pluginsSummaryTools')}</span></span>
            {summary.attention > 0 ? (
              <span className="flex items-baseline gap-1"><b className="text-[16px] tabular-nums text-[#a35a00] dark:text-[#ffc985]">{summary.attention}</b><span className="text-ds-muted">{t('pluginsSummaryAttention')}</span></span>
            ) : null}
          </>
        ) : (
          <span className="text-[12.5px] text-ds-muted">{t('pluginsRuntimeUnavailable')}</span>
        )}
        <span className="flex-1" />
        <button type="button" className={`${pluginButton.small} border border-ds-border bg-ds-card text-ds-ink hover:bg-ds-hover`} onClick={onRefreshStatus} disabled={summary.loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${summary.loading ? 'animate-spin' : ''}`} />
          {t('pluginsRefreshStatus')}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-9 min-w-0 flex-[1_1_220px] items-center gap-2 rounded-[11px] border border-ds-border bg-ds-card px-3 text-ds-muted focus-within:border-[#6f8bff]">
          <Search className="h-4 w-4 shrink-0" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('pluginsSearchInstalledMcp')} aria-label={t('pluginsSearchInstalledMcp')} className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ds-ink outline-none focus-visible:outline-none" />
        </label>
        <div className="inline-flex flex-wrap rounded-[10px] bg-ds-subtle p-[3px]" role="group" aria-label={t('pluginsStatusFilter')}>
          {(['all', ...GROUPS] as StatusFilter[]).map((value) => (
            <button key={value} type="button" aria-pressed={status === value} className={segment(status === value)} onClick={() => setStatus(value)}>
              {filterLabels[value]} {counts[value]}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-ds-subtle px-6 py-12 text-center">
          <div className="text-[14px] font-semibold text-ds-ink">{t('pluginsInstalledEmpty')}</div>
          <button type="button" className={pluginButton.dark} onClick={onDiscover}>{t('pluginsGoDiscover')}</button>
        </div>
      ) : page.total === 0 ? (
        <div className="rounded-2xl bg-ds-subtle px-6 py-10 text-center text-[13px] text-ds-muted">{t('pluginsEmptyFilterTitle')}</div>
      ) : (
        GROUPS.map((group) => {
          const groupRows = page.items.filter((row) => row.group === group)
          if (groupRows.length === 0) return null
          return (
            <section key={group}>
              <h2 className="mx-0.5 mb-2 mt-1 text-[12px] font-semibold tracking-wide text-ds-muted">
                {filterLabels[group]} · {counts[group]}
              </h2>
              <div className="rounded-[14px] border border-ds-border bg-ds-card">
                {groupRows.map((row, index) => {
                  const pill = mcpStatusView(t, row)
                  const badge = mcpSourceBadge(t, row)
                  const isGithub = row.systemManaged && row.id === 'github'
                  const primary = row.status === 'needs-config'
                    ? { label: t('pluginsActionConfigure'), className: `${pluginButton.small} ${pluginButton.warn}`, run: () => onConfigure(row) }
                    : isGithub
                      ? { label: t('pluginsManage'), className: `${pluginButton.small} border border-ds-border bg-ds-card text-ds-ink hover:bg-ds-hover`, run: () => onManageBuiltin(row) }
                      : row.hasConfig
                        ? { label: t('pluginsConfigure'), className: `${pluginButton.small} border border-ds-border bg-ds-card text-ds-ink hover:bg-ds-hover`, run: () => onConfigure(row) }
                        : null
                  return (
                    <div key={row.id} className={`flex items-center gap-3 px-3.5 py-3 ${index > 0 ? 'border-t border-ds-border-muted' : ''}`}>
                      <PluginAvatar id={row.id} title={row.title} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[14px] font-semibold text-ds-ink" title={row.title}>{row.title}</span>
                          {badge.label ? <PluginBadge tone={badge.tone}>{badge.label}</PluginBadge> : null}
                        </div>
                        <div className="mt-0.5 truncate text-[12px] text-ds-muted" title={subLine(t, row)}>{subLine(t, row)}</div>
                      </div>
                      <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
                      {row.systemManaged ? (
                        <span className="flex w-[38px] justify-center text-ds-faint" title={t('pluginsBuiltinLocked')}>
                          <Lock className="h-4 w-4" />
                        </span>
                      ) : (
                        <PluginSwitch
                          checked={row.enabled && row.status !== 'needs-config'}
                          disabled={row.status === 'needs-config' || toggleBusyId === row.id || !row.hasConfig}
                          title={row.status === 'needs-config' ? t('pluginsEnableBlocked') : undefined}
                          label={t('pluginsEnableToggle', { name: row.title })}
                          onChange={(enabled) => onToggle(row, enabled)}
                        />
                      )}
                      {primary ? <button type="button" className={primary.className} onClick={primary.run}>{primary.label}</button> : null}
                      {row.hasConfig ? (
                        <div className="relative">
                          <button type="button" aria-label={t('pluginsMore')} aria-haspopup="menu" aria-expanded={menuFor === row.id} onClick={() => setMenuFor((current) => (current === row.id ? null : row.id))} className="flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {menuFor === row.id ? (
                            <>
                              <div className="fixed inset-0 z-10" onMouseDown={() => setMenuFor(null)} />
                              <div role="menu" className="absolute right-0 top-9 z-20 w-[180px] rounded-xl border border-ds-border bg-ds-card p-1 shadow-[0_18px_48px_rgba(32,55,90,0.14)]">
                                <button type="button" role="menuitem" className="flex h-8 w-full items-center rounded-lg px-2.5 text-left text-[13px] text-ds-ink hover:bg-ds-subtle" onClick={() => { setMenuFor(null); onConfigure(row) }}>{t('pluginsEditConfig')}</button>
                                <button type="button" role="menuitem" className="flex h-8 w-full items-center rounded-lg px-2.5 text-left text-[13px] text-ds-ink hover:bg-ds-subtle" onClick={() => { setMenuFor(null); onCopy(row) }}>{t('pluginsCopyJson')}</button>
                                <button type="button" role="menuitem" className="flex h-8 w-full items-center rounded-lg px-2.5 text-left text-[13px] text-ds-danger hover:bg-ds-danger-soft" onClick={() => { setMenuFor(null); onDelete(row) }}>{t('pluginsDelete')}</button>
                              </div>
                            </>
                          ) : null}
                        </div>
                      ) : <span className="w-8" />}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })
      )}
      <PluginPager t={t} page={page.page} pageCount={page.pageCount} start={page.start} end={page.end} total={page.total} pageSize={PAGE_SIZE} onPage={setPageNumber} />
      <div className="flex items-center gap-1.5 text-[12px] text-ds-muted">
        <Info className="h-3.5 w-3.5" />
        {t('pluginsRestartHint')}
      </div>
    </div>
  )
}
