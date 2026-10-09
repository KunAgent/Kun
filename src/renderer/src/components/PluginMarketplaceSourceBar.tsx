import type { ReactElement } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import type { MarketSyncStatus } from './use-market-catalogs'
import type { MarketSourceFilter } from './plugin-marketplace-market'

type Translate = (key: string, values?: Record<string, unknown>) => string

function chipClass(active: boolean): string {
  return `rounded-full border px-3 py-1 text-[13px] font-medium transition ${
    active
      ? 'border-transparent bg-ds-userbubble text-ds-userbubbleFg shadow-sm'
      : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
  }`
}

/** Status line for the sources behind the cards: sync time, offline cache, errors. */
function statusText(statuses: readonly MarketSyncStatus[], t: Translate): string {
  const failing = statuses.find((status) => status.error && status.fetchedAt === undefined)
  if (failing) return t('marketLoadFailed', { source: failing.label, message: failing.error })
  const offline = statuses.find((status) => status.offline && status.fetchedAt !== undefined)
  if (offline) {
    return t('marketOfflineCache', { source: offline.label, time: new Date(offline.fetchedAt as number).toLocaleString() })
  }
  const times = statuses.flatMap((status) => (status.fetchedAt === undefined ? [] : [status.fetchedAt]))
  return times.length > 0
    ? t('marketSyncedAt', { time: new Date(Math.min(...times)).toLocaleString() })
    : ''
}

export function PluginMarketplaceSourceBar({
  sources,
  filter,
  onFilter,
  syncing,
  statuses,
  onRefresh,
  t
}: {
  sources: ReadonlyArray<{ id: string; label: string }>
  filter: MarketSourceFilter
  onFilter: (filter: MarketSourceFilter) => void
  syncing: boolean
  statuses: readonly MarketSyncStatus[]
  onRefresh: () => void
  t: Translate
}): ReactElement | null {
  if (sources.length === 0) return null
  const text = syncing ? t('marketSyncing') : statusText(statuses, t)
  const failed = !syncing && statuses.some((status) => status.error && status.fetchedAt === undefined)
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label={t('marketSourceFilterLabel')}>
      <span className="mr-1 text-[12px] font-medium text-ds-faint">{t('marketSourceFilterLabel')}</span>
      <button type="button" className={chipClass(filter === 'all')} onClick={() => onFilter('all')}>
        {t('marketSourceAll')}
      </button>
      <button type="button" className={chipClass(filter === 'builtin')} onClick={() => onFilter('builtin')}>
        {t('marketSourceKun')}
      </button>
      {sources.map((source) => (
        <button
          key={source.id}
          type="button"
          className={chipClass(filter === source.id)}
          onClick={() => onFilter(source.id)}
        >
          {source.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onRefresh}
        disabled={syncing}
        title={t('marketRefresh')}
        aria-label={t('marketRefresh')}
        className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      </button>
      {text ? (
        <span className={`text-[12px] ${failed ? 'text-red-700 dark:text-red-300' : 'text-ds-faint'}`}>{text}</span>
      ) : null}
    </div>
  )
}
