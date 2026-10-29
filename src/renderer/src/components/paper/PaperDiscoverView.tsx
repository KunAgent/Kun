import { usePaperSpaceStore } from '../../paper/paper-space-store'
import { useEffect, useState, type ReactElement } from 'react'
import {
  ExternalLink,
  Loader2,
  Newspaper,
  Plus,
  RotateCw,
  Rss,
  Trophy,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import type { PaperArxivTodayItem, PaperFeedItem } from '@shared/paper/paper-library-types'
import {
  decodePaperSearchFeed,
  readSearchSeen,
  writeSearchSeen,
  type PaperSearchFeedSpec
} from '../../paper/paper-search-prefs'
import { ExpandableAbstract, ImportButton } from './discover/PaperDiscoverParts'
import { PaperVenuePane } from './discover/PaperVenuePane'
import { PaperHeaderIconButton, PaperViewHeader } from './PaperViewHeader'

export type PaperDiscoverSource = 'arxiv' | 'feeds' | 'venue'

const SUGGESTED_FEEDS = [
  { title: 'arXiv cs.CL', url: 'https://rss.arxiv.org/rss/cs.CL' },
  { title: 'arXiv cs.LG', url: 'https://rss.arxiv.org/rss/cs.LG' },
  { title: 'arXiv cs.AI', url: 'https://rss.arxiv.org/rss/cs.AI' },
  { title: 'arXiv cs.SE', url: 'https://rss.arxiv.org/rss/cs.SE' },
  { title: 'arXiv cs.CV', url: 'https://rss.arxiv.org/rss/cs.CV' }
]

/** RFC-822 / ISO feed dates → YYYY-MM-DD for display. */
function shortDate(raw: string): string {
  const time = Date.parse(raw)
  return Number.isNaN(time) ? raw : new Date(time).toISOString().slice(0, 10)
}

const SOURCE_ICONS: Record<PaperDiscoverSource, ReactElement> = {
  arxiv: <Newspaper className="h-4 w-4" strokeWidth={1.8} />,
  feeds: <Rss className="h-4 w-4" strokeWidth={1.8} />,
  venue: <Trophy className="h-4 w-4" strokeWidth={1.8} />
}

/**
 * Discover virtual tab (U4/U7): one surface per source — arXiv today, feed
 * subscriptions, or a papers.cool venue listing — under the shared paper
 * view header (source, current listing, refresh).
 */
export function PaperDiscoverView({ source }: { source?: PaperDiscoverSource }): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = usePaperSpaceStore((s) => s.workspaceRoot)
  const feeds = useWriteWorkspaceStore((s) => s.paperMode.discover.feeds)
  const activeFeedId = usePaperModeStore((s) => s.discover.activeFeedId)
  const feedTitle = feeds.find((feed) => feed.id === activeFeedId)?.title ?? ''
  const venue = usePaperModeStore((s) => s.discover.venue)
  const venueGroup = usePaperModeStore((s) => s.discover.venueGroup)
  const effectiveSource = source ?? 'arxiv'
  const [reloadKey, setReloadKey] = useState(0)

  const arxivDate = usePaperModeStore((s) => s.discover.arxivDate)
  const meta =
    effectiveSource === 'arxiv'
      ? arxivDate
      : effectiveSource === 'feeds'
        ? feedTitle
        : [venue, venueGroup].filter(Boolean).join(' · ')

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PaperViewHeader
        icon={SOURCE_ICONS[effectiveSource]}
        title={t(`writePaperDiscoverTab_${effectiveSource}`)}
        meta={meta || undefined}
        actions={(
          <>
            <PaperHeaderIconButton label={t('writePaperDiscoverRefresh')} onClick={() => setReloadKey((value) => value + 1)}>
              <RotateCw className="h-3.5 w-3.5" strokeWidth={1.9} />
            </PaperHeaderIconButton>
          </>
        )}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[960px] px-6 pb-10 pt-4">
          {effectiveSource === 'arxiv' ? (
            <ArxivTodayPane workspaceRoot={workspaceRoot} reloadKey={reloadKey} />
          ) : effectiveSource === 'feeds' ? (
            <FeedsPane workspaceRoot={workspaceRoot} reloadKey={reloadKey} />
          ) : (
            <PaperVenuePane workspaceRoot={workspaceRoot} reloadKey={reloadKey} />
          )}
        </div>
      </div>
    </div>
  )
}

function ArxivTodayPane({
  workspaceRoot,
  reloadKey
}: {
  workspaceRoot: string
  reloadKey: number
}): ReactElement {
  const { t } = useTranslation('common')
  const categories = useWriteWorkspaceStore((s) => s.paperMode.discover.arxivCategories)
  const discover = usePaperModeStore((s) => s.discover)
  const patchDiscover = usePaperModeStore((s) => s.patchDiscover)

  const load = (force: boolean): void => {
    if (typeof window.kunGui?.paperArxivToday !== 'function') return
    patchDiscover({ arxivLoading: true, arxivError: null })
    void window.kunGui
      .paperArxivToday({ categories, force })
      .then((result) => {
        if (result.ok) {
          patchDiscover({ arxivItems: result.items, arxivDate: result.date, arxivLoading: false })
        } else {
          patchDiscover({ arxivLoading: false, arxivError: result.message })
        }
      })
      .catch((error: unknown) => {
        patchDiscover({
          arxivLoading: false,
          arxivError: error instanceof Error ? error.message : String(error)
        })
      })
  }

  useEffect(() => {
    if (!discover.arxivItems.length && !discover.arxivLoading) load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.join(',')])

  useEffect(() => {
    if (reloadKey > 0) load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  const items = [...discover.arxivItems]
  if (discover.arxivSort === 'relevance') items.sort((a, b) => b.relevance - a.relevance)

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-[12px] text-ds-faint">
        <span className="min-w-0 truncate">
          {t('paperArxivTodaySummary', { count: discover.arxivItems.length, categories: categories.join(', ') })}
        </span>
        {discover.arxivLoading && discover.arxivItems.length ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
        <div className="flex-1" />
        <div className="flex h-7 shrink-0 items-center rounded-md border border-ds-border-muted bg-ds-subtle p-0.5">
          {(['relevance', 'announcement'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => patchDiscover({ arxivSort: value })}
              className={`inline-flex h-6 items-center rounded px-2 text-[11.5px] transition ${
                discover.arxivSort === value ? 'bg-ds-main font-medium text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'
              }`}
            >
              {t(value === 'relevance' ? 'writePaperDiscoverSortRelevance' : 'writePaperDiscoverSortAnnouncement')}
            </button>
          ))}
        </div>
      </div>
      {discover.arxivError ? (
        <p className="rounded-lg border border-red-200/70 bg-red-50/80 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {discover.arxivError}
        </p>
      ) : null}
      {!discover.arxivItems.length && !discover.arxivLoading ? (
        <p className="py-10 text-center text-[12.5px] text-ds-faint">
          {t('writePaperDiscoverArxivEmpty')}
        </p>
      ) : null}
      {discover.arxivLoading && !discover.arxivItems.length ? (
        <div className="flex items-center justify-center gap-2 py-10 text-ds-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : null}
      <ul className="space-y-2.5">
        {items.map((item) => (
          <ArxivRow key={item.arxivId} item={item} workspaceRoot={workspaceRoot} t={t} />
        ))}
      </ul>
    </div>
  )
}

function ArxivRow({
  item,
  workspaceRoot,
  t
}: {
  item: PaperArxivTodayItem
  workspaceRoot: string
  t: (key: string) => string
}): ReactElement {
  return (
    <li className="rounded-lg border border-ds-border-muted bg-ds-card px-4 py-3 transition hover:border-ds-border">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-5 text-ds-ink">{item.title}</p>
          {item.authors.length ? (
            <p className="mt-0.5 truncate text-[12px] text-ds-muted" title={item.authors.join(', ')}>
              {item.authors.slice(0, 6).join(', ')}
              {item.authors.length > 6 ? ` +${item.authors.length - 6}` : ''}
            </p>
          ) : null}
          <p className="mt-0.5 truncate text-[11.5px] text-ds-faint">
            {[item.arxivId, item.publishedAt, item.categories.join(' ')].filter(Boolean).join(' · ')}
          </p>
        </div>
        {item.relevance > 0 ? (
          <span className="shrink-0 rounded bg-ds-subtle px-1.5 py-px text-[10.5px] tabular-nums text-ds-muted" title={t('writePaperDiscoverSortRelevance')}>
            {Math.round(item.relevance * 100)}%
          </span>
        ) : null}
        <ImportButton input={item.arxivId} workspaceRoot={workspaceRoot} t={t} />
      </div>
      {item.abstract ? <ExpandableAbstract text={item.abstract} /> : null}
      <div className="mt-2 flex items-center justify-end gap-1">
        {([['arXiv', `https://arxiv.org/abs/${item.arxivId}`], ['PDF', `https://arxiv.org/pdf/${item.arxivId}`]] as const).map(([label, url]) => (
          <a
            key={label}
            href="#"
            onClick={(event) => {
              event.preventDefault()
              void window.kunGui?.openExternal?.(url)
            }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <ExternalLink className="h-3 w-3" />
            {label}
          </a>
        ))}
      </div>
    </li>
  )
}

function FeedsPane({
  workspaceRoot,
  reloadKey
}: {
  workspaceRoot: string
  reloadKey: number
}): ReactElement {
  const { t } = useTranslation('common')
  const feeds = useWriteWorkspaceStore((s) => s.paperMode.discover.feeds)
  const discover = usePaperModeStore((s) => s.discover)
  const patchDiscover = usePaperModeStore((s) => s.patchDiscover)
  const [newFeedUrl, setNewFeedUrl] = useState('')

  const patchFeeds = (next: typeof feeds): void => {
    useWriteWorkspaceStore.setState((s) => ({
      paperMode: {
        ...s.paperMode,
        discover: { ...s.paperMode.discover, feeds: next }
      }
    }))
    void rendererRuntimeClient
      .setSettings({ write: { paperMode: { discover: { feeds: next } } } })
      .catch(() => undefined)
  }

  const addFeed = (): void => {
    const url = newFeedUrl.trim()
    if (!url || feeds.some((feed) => feed.url === url)) return
    patchFeeds([
      ...feeds,
      { id: `feed-${Date.now().toString(36)}`, url, title: url }
    ])
    setNewFeedUrl('')
  }

  // Saved-search subscriptions (plan P5): `kun-paper-search://` feeds re-run
  // the multi-source search and mark hits not seen on the previous check.
  const loadSearchFeed = (feedId: string, spec: PaperSearchFeedSpec): void => {
    if (typeof window.kunGui?.paperSearch !== 'function') return
    patchDiscover({ feedLoading: true, feedError: null, activeFeedId: feedId })
    void window.kunGui
      .paperSearch({
        query: spec.query,
        sources: spec.sources,
        limit: 20,
        yearFrom: spec.yearFrom,
        yearTo: spec.yearTo
      })
      .then((result) => {
        if (!result.ok) {
          patchDiscover({ feedLoading: false, feedError: result.message })
          return
        }
        const seen = readSearchSeen(feedId)
        const seenKeys = new Set(seen.keys)
        const items: PaperFeedItem[] = result.hits.map((hit) => ({
          title: hit.title,
          url:
            hit.url ??
            (hit.doi ? `https://doi.org/${hit.doi}` : hit.arxivId ? `https://arxiv.org/abs/${hit.arxivId}` : ''),
          publishedAt: hit.year ? String(hit.year) : undefined,
          summary: hit.abstract,
          arxivId: hit.arxivId,
          doi: hit.doi,
          isNew: Boolean(seen.checkedAt) && !seenKeys.has(hit.key)
        }))
        writeSearchSeen(feedId, result.hits.map((hit) => hit.key))
        patchDiscover({
          feedItems: { ...usePaperModeStore.getState().discover.feedItems, [feedId]: items },
          feedLoading: false
        })
      })
      .catch((error: unknown) => {
        patchDiscover({
          feedLoading: false,
          feedError: error instanceof Error ? error.message : String(error)
        })
      })
  }

  const loadFeed = (feedId: string, url: string): void => {
    const searchSpec = decodePaperSearchFeed(url)
    if (searchSpec) {
      loadSearchFeed(feedId, searchSpec)
      return
    }
    if (typeof window.kunGui?.paperFetchFeed !== 'function') return
    patchDiscover({ feedLoading: true, feedError: null, activeFeedId: feedId })
    void window.kunGui
      .paperFetchFeed({ url })
      .then((result) => {
        if (result.ok) {
          patchDiscover({
            feedItems: { ...usePaperModeStore.getState().discover.feedItems, [feedId]: result.items },
            feedLoading: false
          })
        } else {
          patchDiscover({ feedLoading: false, feedError: result.message })
        }
      })
      .catch((error: unknown) => {
        patchDiscover({
          feedLoading: false,
          feedError: error instanceof Error ? error.message : String(error)
        })
      })
  }

  useEffect(() => {
    if (!discover.activeFeedId && feeds.length) loadFeed(feeds[0].id, feeds[0].url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeds.length])

  useEffect(() => {
    if (reloadKey <= 0) return
    const feed = feeds.find((item) => item.id === discover.activeFeedId) ?? feeds[0]
    if (feed) loadFeed(feed.id, feed.url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  const activeItems = discover.feedItems[discover.activeFeedId] ?? []
  const addSuggested = (url: string, title: string): void => {
    if (feeds.some((feed) => feed.url === url)) return
    const id = `feed-${Date.now().toString(36)}`
    patchFeeds([...feeds, { id, url, title }])
    loadFeed(id, url)
  }
  const addField = (
    <div className="flex min-w-0 items-center gap-1.5">
      <input
        value={newFeedUrl}
        onChange={(event) => setNewFeedUrl(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') addFeed() }}
        placeholder={t('writePaperDiscoverAddFeed')}
        spellCheck={false}
        className="h-8 min-w-0 flex-1 rounded-lg border border-ds-border-muted bg-ds-main px-2.5 text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint focus:border-[var(--ds-accent)]"
      />
      <button
        type="button"
        onClick={addFeed}
        disabled={!newFeedUrl.trim()}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-[var(--ds-control)] px-2.5 text-[12px] font-medium text-[var(--ds-control-foreground)] transition hover:opacity-90 disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('writePaperDiscoverAddFeedButton')}
      </button>
    </div>
  )

  if (!feeds.length) {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col items-center pt-[10vh] text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-ds-border-muted bg-ds-subtle text-ds-muted">
          <Rss className="h-5 w-5" strokeWidth={1.8} />
        </span>
        <h2 className="mt-4 text-[17px] font-medium text-ds-ink">{t('paperFeedsEmptyTitle')}</h2>
        <p className="mt-1.5 text-[12.5px] leading-5 text-ds-muted">{t('paperFeedsEmptySub')}</p>
        <div className="mt-5 w-full">{addField}</div>
        <p className="mt-6 text-[11.5px] text-ds-faint">{t('paperFeedsSuggested')}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {SUGGESTED_FEEDS.map((feed) => (
            <button
              key={feed.url}
              type="button"
              onClick={() => addSuggested(feed.url, feed.title)}
              className="inline-flex items-center gap-1 rounded-full border border-ds-border-muted px-3 py-1 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <Plus className="h-3 w-3" />
              {feed.title}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {feeds.map((feed) => {
            const active = discover.activeFeedId === feed.id
            return (
              <span
                key={feed.id}
                className={`group inline-flex h-7 items-center gap-1 rounded-md pl-2.5 pr-1 text-[12px] transition ${
                  active ? 'bg-[var(--ds-sidebar-row-active)] font-medium text-ds-ink' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                }`}
              >
                <button type="button" onClick={() => loadFeed(feed.id, feed.url)} className="max-w-[220px] truncate">
                  {feed.title}
                </button>
                <button
                  type="button"
                  aria-label={t('writePaperDiscoverRemoveFeed')}
                  onClick={() => patchFeeds(feeds.filter((item) => item.id !== feed.id))}
                  className="rounded p-0.5 text-ds-faint opacity-0 transition hover:text-ds-ink group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
        </div>
        <div className="w-[320px] max-w-full">{addField}</div>
      </div>
      {discover.feedError ? (
        <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {discover.feedError}
        </p>
      ) : null}
      {discover.feedLoading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-ds-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : null}
      <ul className="space-y-2">
        {activeItems.map((item: PaperFeedItem) => (
          <li
            key={item.url}
            className="rounded-lg border border-ds-border-muted bg-ds-card px-4 py-3 transition hover:border-ds-border"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold leading-5 text-ds-ink">
                  {item.isNew ? (
                    <span className="mr-1.5 inline-block rounded bg-accent-tint/15 px-1 py-px align-middle text-[10px] font-medium text-accent">
                      {t('writePaperDiscoverFeedNew')}
                    </span>
                  ) : null}
                  {item.title}
                </p>
                {item.publishedAt ? (
                  <p className="mt-0.5 text-[11.5px] text-ds-faint">{shortDate(item.publishedAt)}</p>
                ) : null}
              </div>
              {item.arxivId || item.doi ? (
                <ImportButton input={item.arxivId ?? item.doi ?? ''} workspaceRoot={workspaceRoot} t={t} />
              ) : null}
            </div>
            {item.summary ? <ExpandableAbstract text={item.summary} /> : null}
            {item.url ? (
              <div className="mt-2 flex justify-end">
                <a
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                  href="#"
                  onClick={(event) => {
                    event.preventDefault()
                    void window.kunGui?.openExternal?.(item.url)
                  }}
                >
                  <ExternalLink className="h-3 w-3" />
                  {t('writePaperDiscoverOpenLink')}
                </a>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
