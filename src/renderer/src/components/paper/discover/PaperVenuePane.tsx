import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { BookOpenText, Eye, FileText, Loader2, RotateCw, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PaperVenueCatalogEntry, PaperVenueItem } from '@shared/paper/paper-library-types'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { ExpandableAbstract, ImportButton } from './PaperDiscoverParts'

type Translate = (key: string, opts?: Record<string, unknown>) => string

// Series shown first, in this order; the rest follow alphabetically.
const PREFERRED_SERIES = [
  'ICLR', 'NeurIPS', 'ICML', 'ACL', 'EMNLP', 'NAACL', 'COLM', 'CVPR', 'ICCV', 'ECCV',
  'AAAI', 'IJCAI', 'CoRL', 'COLT', 'UAI', 'MLSYS'
]

// Tracks with more entries than this use a dropdown instead of segments.
const MAX_GROUP_SEGMENTS = 6

const GROUP_TONE: Record<string, string> = {
  oral: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  spotlight: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  outstanding: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  highlight: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
}

function seriesOrder(catalog: PaperVenueCatalogEntry[]): string[] {
  const all = [...new Set(catalog.map((entry) => entry.series))]
  const preferred = PREFERRED_SERIES.filter((name) => all.includes(name))
  const rest = all.filter((name) => !preferred.includes(name)).sort((a, b) => a.localeCompare(b))
  return [...preferred, ...rest]
}

function defaultVenue(catalog: PaperVenueCatalogEntry[]): string {
  const series = seriesOrder(catalog)[0]
  return editions(catalog, series)[0]?.id ?? ''
}

function editions(catalog: PaperVenueCatalogEntry[], series: string | undefined): PaperVenueCatalogEntry[] {
  return catalog
    .filter((entry) => entry.series === series)
    .sort((a, b) => b.year.localeCompare(a.year))
}

function matches(item: PaperVenueItem, needle: string): boolean {
  if (!needle) return true
  return [item.title, item.authors.join(' '), item.abstract ?? '']
    .some((text) => text.toLowerCase().includes(needle))
}

function segmentClass(active: boolean): string {
  return `inline-flex h-6 shrink-0 items-center rounded px-2 text-[12px] transition ${
    active ? 'bg-ds-main font-medium text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
  }`
}

/**
 * Conference papers from papers.cool: pick a series, an edition and a track,
 * then page through the accepted papers (abstract, PDF, forum link, import).
 */
export function PaperVenuePane({
  workspaceRoot,
  reloadKey
}: {
  workspaceRoot: string
  reloadKey: number
}): ReactElement {
  const { t } = useTranslation('common')
  const discover = usePaperModeStore((s) => s.discover)
  const patchDiscover = usePaperModeStore((s) => s.patchDiscover)
  const [query, setQuery] = useState('')
  const [customVenue, setCustomVenue] = useState('')
  const catalog = discover.venueCatalog

  const loadCatalog = (force: boolean): void => {
    if (typeof window.kunGui?.paperVenueCatalog !== 'function') return
    patchDiscover({ venueCatalogLoading: true, venueCatalogError: null })
    void window.kunGui
      .paperVenueCatalog({ force })
      .then((result) => {
        if (result.ok) patchDiscover({ venueCatalog: result.venues, venueCatalogLoading: false })
        else patchDiscover({ venueCatalogLoading: false, venueCatalogError: result.message })
      })
      .catch((error: unknown) => {
        patchDiscover({
          venueCatalogLoading: false,
          venueCatalogError: error instanceof Error ? error.message : String(error)
        })
      })
  }

  const loadVenue = (venue: string, group: string, append = false): void => {
    if (!venue || typeof window.kunGui?.paperListVenue !== 'function') return
    const skip = append ? usePaperModeStore.getState().discover.venueItems.length : 0
    patchDiscover({
      venue,
      venueGroup: group,
      venueLoading: true,
      venueError: null,
      ...(append ? {} : { venueItems: [], venueTotal: 0 })
    })
    const isCurrent = (): boolean => {
      const current = usePaperModeStore.getState().discover
      return current.venue === venue && current.venueGroup === group
    }
    void window.kunGui
      .paperListVenue({ venue, group: group || undefined, skip })
      .then((result) => {
        if (!isCurrent()) return
        if (!result.ok) {
          patchDiscover({ venueLoading: false, venueError: result.message })
          return
        }
        const previous = append ? usePaperModeStore.getState().discover.venueItems : []
        const seen = new Set(previous.map((item) => item.coolId))
        patchDiscover({
          venueItems: [...previous, ...result.items.filter((item) => !seen.has(item.coolId))],
          venueTotal: result.total,
          venueLoading: false
        })
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return
        patchDiscover({
          venueLoading: false,
          venueError: error instanceof Error ? error.message : String(error)
        })
      })
  }

  useEffect(() => {
    if (!catalog.length && !discover.venueCatalogLoading) loadCatalog(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // First visit: open the newest edition of the first series; later visits
  // keep whatever was on screen.
  useEffect(() => {
    if (discover.venueLoading || discover.venueItems.length) return
    const venue = discover.venue || defaultVenue(catalog)
    if (venue) loadVenue(venue, discover.venue ? discover.venueGroup : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog])

  useEffect(() => {
    if (reloadKey === 0) return
    if (!catalog.length) loadCatalog(true)
    loadVenue(discover.venue, discover.venueGroup)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  const seriesList = useMemo(() => seriesOrder(catalog), [catalog])
  const activeEntry = catalog.find((entry) => entry.id === discover.venue)
  const activeSeries = activeEntry?.series ?? discover.venue.replace(/\.\d{4}$/, '')
  const years = editions(catalog, activeSeries)
  const groups = activeEntry?.groups ?? []
  const needle = query.trim().toLowerCase()
  const visible = discover.venueItems.filter((item) => matches(item, needle))
  const hasMore = discover.venueItems.length < discover.venueTotal

  return (
    <div className="mx-auto w-full max-w-[1040px]">
      {discover.venueCatalogError && !catalog.length ? (
        <CatalogError
          message={discover.venueCatalogError}
          customVenue={customVenue}
          onCustomVenue={setCustomVenue}
          onRetry={() => loadCatalog(true)}
          onLoad={() => loadVenue(customVenue.trim(), '')}
          t={t}
        />
      ) : null}

      {discover.venueCatalogLoading && !catalog.length ? (
        <div className="flex h-8 items-center gap-2 text-[12px] text-ds-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('writePaperVenueCatalogLoading')}
        </div>
      ) : null}

      {seriesList.length ? (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('writePaperVenueSeries')}>
          {seriesList.map((series) => {
            const active = series === activeSeries
            return (
              <button
                key={series}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  const newest = editions(catalog, series)[0]
                  if (newest && !active) loadVenue(newest.id, '')
                }}
                className={`h-7 rounded-md px-2.5 text-[12.5px] transition ${
                  active
                    ? 'bg-[var(--ds-sidebar-row-active)] font-medium text-ds-ink'
                    : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                }`}
              >
                {series}
              </button>
            )
          })}
        </div>
      ) : null}

      {discover.venue ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-b border-ds-border-muted pb-3">
          {years.length ? (
            <div className="flex h-7 max-w-full items-center overflow-x-auto rounded-md border border-ds-border-muted bg-ds-subtle p-0.5">
              {years.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => loadVenue(entry.id, '')}
                  className={segmentClass(entry.id === discover.venue)}
                >
                  {entry.year}
                </button>
              ))}
            </div>
          ) : null}
          {groups.length > MAX_GROUP_SEGMENTS ? (
            <select
              value={discover.venueGroup}
              onChange={(event) => loadVenue(discover.venue, event.target.value)}
              aria-label={t('writePaperVenueGroup')}
              className="h-7 max-w-[16rem] rounded-md border border-ds-border-muted bg-ds-main px-1.5 text-[12px] text-ds-muted outline-none focus:border-[var(--ds-accent)]"
            >
              <option value="">{t('writePaperVenueGroupAll')}</option>
              {groups.map((group) => <option key={group} value={group}>{group}</option>)}
            </select>
          ) : groups.length ? (
            <div className="flex h-7 items-center rounded-md border border-ds-border-muted bg-ds-subtle p-0.5">
              {['', ...groups].map((group) => (
                <button
                  key={group || 'all'}
                  type="button"
                  onClick={() => loadVenue(discover.venue, group)}
                  className={segmentClass(group === discover.venueGroup)}
                >
                  {group || t('writePaperVenueGroupAll')}
                </button>
              ))}
            </div>
          ) : null}
          <label className="relative ml-auto flex h-7 w-56 min-w-[10rem] items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-ds-faint" strokeWidth={1.9} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('writePaperVenueFilterPlaceholder')}
              aria-label={t('writePaperVenueFilterPlaceholder')}
              className="h-7 w-full rounded-md border border-ds-border-muted bg-ds-main pl-7 pr-6 text-[12.5px] text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-[var(--ds-accent)]"
            />
            {query ? (
              <button
                type="button"
                aria-label={t('clearSearch')}
                onClick={() => setQuery('')}
                className="absolute right-1 rounded p-0.5 text-ds-faint hover:text-ds-ink"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            ) : null}
          </label>
        </div>
      ) : null}

      {discover.venue ? (
        <div className="flex h-9 items-center gap-2 text-[12px] text-ds-faint">
          <span className="font-medium text-ds-muted">
            {discover.venue}
            {discover.venueGroup ? ` · ${discover.venueGroup}` : ''}
          </span>
          {discover.venueTotal ? (
            <span className="tabular-nums">
              {t('writePaperVenueLoaded', { shown: discover.venueItems.length, total: discover.venueTotal })}
            </span>
          ) : null}
        </div>
      ) : null}

      {discover.venueError ? (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <span className="min-w-0 flex-1">{discover.venueError}</span>
          <button
            type="button"
            onClick={() => loadVenue(discover.venue, discover.venueGroup, discover.venueItems.length > 0)}
            className="inline-flex shrink-0 items-center gap-1 font-medium hover:underline"
          >
            <RotateCw className="h-3 w-3" />
            {t('writePaperVenueRetry')}
          </button>
        </div>
      ) : null}

      {discover.venueLoading && !discover.venueItems.length ? (
        <div className="flex items-center justify-center py-16 text-ds-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : null}

      {!discover.venueLoading && !discover.venueError && discover.venue && !visible.length ? (
        <p className="py-16 text-center text-[12.5px] text-ds-faint">
          {needle ? t('writePaperVenueNoMatch') : t('writePaperVenueEmpty')}
        </p>
      ) : null}

      <ul className="space-y-2">
        {visible.map((item) => (
          <VenueRow key={item.coolId} item={item} workspaceRoot={workspaceRoot} t={t} />
        ))}
      </ul>

      {hasMore && discover.venueItems.length ? (
        <div className="flex justify-center py-4">
          <button
            type="button"
            disabled={discover.venueLoading}
            onClick={() => loadVenue(discover.venue, discover.venueGroup, true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-ds-border-muted px-3 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-60"
          >
            {discover.venueLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('writePaperVenueLoadMore', {
              shown: discover.venueItems.length,
              total: discover.venueTotal
            })}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function CatalogError({
  message,
  customVenue,
  onCustomVenue,
  onRetry,
  onLoad,
  t
}: {
  message: string
  customVenue: string
  onCustomVenue: (value: string) => void
  onRetry: () => void
  onLoad: () => void
  t: Translate
}): ReactElement {
  return (
    <div className="mb-3 rounded-md border border-ds-border-muted bg-ds-subtle px-3 py-2.5 text-[12px] text-ds-muted">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">{t('writePaperVenueCatalogError', { message })}</span>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-medium text-ds-ink hover:underline">
          <RotateCw className="h-3 w-3" />
          {t('writePaperVenueRetry')}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={customVenue}
          onChange={(event) => onCustomVenue(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') onLoad() }}
          placeholder={t('writePaperDiscoverVenuePlaceholder')}
          spellCheck={false}
          className="h-7 w-56 rounded-md border border-ds-border-muted bg-ds-main px-2 font-mono text-[12px] text-ds-ink outline-none focus:border-[var(--ds-accent)]"
        />
        <button
          type="button"
          onClick={onLoad}
          disabled={!customVenue.trim()}
          className="inline-flex h-7 items-center rounded-md bg-[var(--ds-control)] px-2.5 text-[12px] font-medium text-[var(--ds-control-foreground)] transition hover:opacity-90 disabled:opacity-50"
        >
          {t('writePaperDiscoverVenueGo')}
        </button>
      </div>
    </div>
  )
}

function LinkChip({ label, url, icon }: { label: string; url: string; icon?: ReactElement }): ReactElement {
  return (
    <a
      href="#"
      onClick={(event) => {
        event.preventDefault()
        void window.kunGui?.openExternal?.(url)
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
    >
      {icon}
      {label}
    </a>
  )
}

function VenueRow({
  item,
  workspaceRoot,
  t
}: {
  item: PaperVenueItem
  workspaceRoot: string
  t: Translate
}): ReactElement {
  const shownAuthors = item.authors.slice(0, 6).join(', ')
  const extraAuthors = item.authors.length - 6
  const tone = GROUP_TONE[(item.group ?? '').toLowerCase()] ?? 'bg-ds-subtle text-ds-muted'
  return (
    <li className="rounded-lg border border-ds-border-muted bg-ds-card px-4 py-3 transition hover:border-ds-border">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-5 text-ds-ink">{item.title}</p>
          {shownAuthors ? (
            <p className="mt-0.5 truncate text-[12px] text-ds-muted" title={item.authors.join(', ')}>
              {shownAuthors}
              {extraAuthors > 0 ? ` +${extraAuthors}` : ''}
            </p>
          ) : null}
        </div>
        <ImportButton input={item.coolId} workspaceRoot={workspaceRoot} t={t} />
      </div>
      {item.abstract ? <ExpandableAbstract text={item.abstract} /> : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {item.group ? (
          <span className={`rounded px-1.5 py-px text-[10.5px] font-medium ${tone}`}>{item.group}</span>
        ) : null}
        {typeof item.stars === 'number' ? (
          <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-ds-faint" title={t('writePaperVenueReads')}>
            <Eye className="h-3 w-3" strokeWidth={1.8} />
            {item.stars}
          </span>
        ) : null}
        <span className="flex-1" />
        {item.sourceUrl ? (
          <LinkChip
            label={t('writePaperVenuePaperPage')}
            url={item.sourceUrl}
            icon={<BookOpenText className="h-3 w-3" strokeWidth={1.8} />}
          />
        ) : null}
        {item.pdfUrl ? (
          <LinkChip label="PDF" url={item.pdfUrl} icon={<FileText className="h-3 w-3" strokeWidth={1.8} />} />
        ) : null}
        <LinkChip label="papers.cool" url={`https://papers.cool/venue/${item.coolId}`} />
      </div>
    </li>
  )
}
