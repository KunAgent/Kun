import { useEffect, useState, type ReactElement } from 'react'
import {
  Compass,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  Rss,
  Trophy,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { newPaperRequestId, usePaperStore } from '../../write/paper/paper-store'
import type {
  PaperArxivTodayItem,
  PaperFeedItem,
  PaperVenueItem
} from '@shared/paper/paper-library-types'

type DiscoverTab = 'arxiv' | 'feeds' | 'venue'

/**
 * Discover view (§3.4, PM5): arXiv-today with library-corpus relevance,
 * feed subscriptions, and papers.cool venue listings. Every item offers a
 * one-click import into the active paper library.
 */
export function PaperDiscoverView(): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const [tab, setTab] = useState<DiscoverTab>('arxiv')
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-ds-border-muted px-4 py-2.5">
        <Compass className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
        <span className="text-[14px] font-semibold text-ds-ink">
          {t('writePaperModeDiscover')}
        </span>
        <div className="ml-2 flex gap-1">
          {(['arxiv', 'feeds', 'venue'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-md px-2 py-1 text-[12px] ${
                tab === key
                  ? 'bg-accent/15 font-medium text-accent'
                  : 'text-ds-muted hover:bg-ds-hover'
              }`}
            >
              {t(`writePaperDiscoverTab_${key}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'arxiv' ? (
          <ArxivTodayPane workspaceRoot={workspaceRoot} />
        ) : tab === 'feeds' ? (
          <FeedsPane workspaceRoot={workspaceRoot} />
        ) : (
          <VenuePane workspaceRoot={workspaceRoot} />
        )}
      </div>
    </div>
  )
}

function ImportButton({
  input,
  workspaceRoot,
  t
}: {
  input: string
  workspaceRoot: string
  t: (key: string) => string
}): ReactElement | null {
  const entries = usePaperModeStore((s) => s.entries)
  const refreshEntries = usePaperModeStore((s) => s.refreshEntries)
  const paperReading = useWriteWorkspaceStore((s) => s.paperReading)
  const [busy, setBusy] = useState(false)
  const inLibrary = entries.some(
    (e) => e.meta.arxivId === input || e.meta.doi?.toLowerCase() === input.toLowerCase()
  )
  if (inLibrary) {
    return (
      <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">
        {t('writePaperRefInLibrary')}
      </span>
    )
  }
  const run = async (): Promise<void> => {
    if (busy || typeof window.kunGui?.paperImport !== 'function') return
    setBusy(true)
    try {
      const result = await window.kunGui.paperImport({
        workspaceRoot,
        input,
        parentDir: paperReading.papersDir || 'papers',
        requestId: newPaperRequestId()
      })
      if (result.ok) refreshEntries()
      else usePaperStore.getState().setNotice({ tone: 'error', message: result.message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void run()}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ds-border px-2 py-0.5 text-[11px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
      {t('writePaperImport')}
    </button>
  )
}

function ArxivTodayPane({ workspaceRoot }: { workspaceRoot: string }): ReactElement {
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

  const items = [...discover.arxivItems]
  if (discover.arxivSort === 'relevance') items.sort((a, b) => b.relevance - a.relevance)

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Newspaper className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
        <span className="text-[13px] font-medium text-ds-ink">
          {t('writePaperDiscoverArxivToday')}
        </span>
        {discover.arxivDate ? (
          <span className="text-[11.5px] text-ds-faint">{discover.arxivDate}</span>
        ) : null}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() =>
            patchDiscover({
              arxivSort: discover.arxivSort === 'relevance' ? 'announcement' : 'relevance'
            })
          }
          className="rounded-md border border-ds-border px-2 py-1 text-[11px] text-ds-muted transition hover:bg-ds-hover"
        >
          {discover.arxivSort === 'relevance'
            ? t('writePaperDiscoverSortAnnouncement')
            : t('writePaperDiscoverSortRelevance')}
        </button>
        <button
          type="button"
          onClick={() => load(true)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${discover.arxivLoading ? 'animate-spin' : ''}`} />
        </button>
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
      <ul className="space-y-2">
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
    <li className="rounded-xl border border-ds-border-muted bg-ds-card/60 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-5 text-ds-ink">{item.title}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-ds-faint">
            {item.authors.slice(0, 4).join(', ')}
            {item.categories.length ? ` · ${item.categories.join(', ')}` : ''}
          </p>
        </div>
        {item.relevance > 0 ? (
          <span className="shrink-0 rounded-full bg-accent/[0.08] px-1.5 py-px text-[10px] text-accent">
            {Math.round(item.relevance * 100)}%
          </span>
        ) : null}
        <ImportButton input={item.arxivId} workspaceRoot={workspaceRoot} t={t} />
      </div>
      {item.abstract ? (
        <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-4.5 text-ds-muted">{item.abstract}</p>
      ) : null}
    </li>
  )
}

function FeedsPane({ workspaceRoot }: { workspaceRoot: string }): ReactElement {
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

  const loadFeed = (feedId: string, url: string): void => {
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

  const activeItems = discover.feedItems[discover.activeFeedId] ?? []

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Rss className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
        <input
          value={newFeedUrl}
          onChange={(event) => setNewFeedUrl(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') addFeed() }}
          placeholder={t('writePaperDiscoverAddFeed')}
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-lg border border-ds-border bg-ds-main/65 px-2 text-[12px] text-ds-ink outline-none focus:border-accent/40"
        />
        <button
          type="button"
          onClick={addFeed}
          disabled={!newFeedUrl.trim()}
          className="inline-flex h-7 items-center gap-1 rounded-lg bg-accent/10 px-2 text-[12px] font-medium text-accent transition hover:bg-accent/15 disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          {t('writePaperDiscoverAddFeedButton')}
        </button>
      </div>
      {feeds.length ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {feeds.map((feed) => (
            <span
              key={feed.id}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] ${
                discover.activeFeedId === feed.id
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-ds-border text-ds-muted'
              }`}
            >
              <button type="button" onClick={() => loadFeed(feed.id, feed.url)}>
                {feed.title}
              </button>
              <button
                type="button"
                aria-label={t('writePaperDiscoverRemoveFeed')}
                onClick={() => patchFeeds(feeds.filter((item) => item.id !== feed.id))}
                className="text-ds-faint transition hover:text-ds-ink"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-[12.5px] text-ds-faint">
          {t('writePaperDiscoverNoFeeds')}
        </p>
      )}
      {discover.feedError ? (
        <p className="mb-2 rounded-lg border border-red-200/70 bg-red-50/80 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
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
          <li key={item.url} className="rounded-xl border border-ds-border-muted bg-ds-card/60 p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium leading-5 text-ds-ink">{item.title}</p>
                <p className="mt-0.5 text-[11px] text-ds-faint">{item.publishedAt ?? ''}</p>
              </div>
              {item.arxivId || item.doi ? (
                <ImportButton
                  input={item.arxivId ?? item.doi ?? ''}
                  workspaceRoot={workspaceRoot}
                  t={t}
                />
              ) : null}
            </div>
            {item.summary ? (
              <p className="mt-1 line-clamp-2 text-[11.5px] leading-4.5 text-ds-muted">{item.summary}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function VenuePane({ workspaceRoot }: { workspaceRoot: string }): ReactElement {
  const { t } = useTranslation('common')
  const discover = usePaperModeStore((s) => s.discover)
  const patchDiscover = usePaperModeStore((s) => s.patchDiscover)
  const [venueInput, setVenueInput] = useState(discover.venue)

  const loadVenue = (): void => {
    const venue = venueInput.trim()
    if (!venue || typeof window.kunGui?.paperListVenue !== 'function') return
    patchDiscover({ venue, venueLoading: true, venueError: null })
    void window.kunGui
      .paperListVenue({ venue })
      .then((result) => {
        if (result.ok) patchDiscover({ venueItems: result.items, venueLoading: false })
        else patchDiscover({ venueLoading: false, venueError: result.message })
      })
      .catch((error: unknown) => {
        patchDiscover({
          venueLoading: false,
          venueError: error instanceof Error ? error.message : String(error)
        })
      })
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
        <input
          value={venueInput}
          onChange={(event) => setVenueInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') loadVenue() }}
          placeholder={t('writePaperDiscoverVenuePlaceholder')}
          spellCheck={false}
          className="h-7 w-56 rounded-lg border border-ds-border bg-ds-main/65 px-2 font-mono text-[12px] text-ds-ink outline-none focus:border-accent/40"
        />
        <button
          type="button"
          onClick={loadVenue}
          disabled={!venueInput.trim() || discover.venueLoading}
          className="inline-flex h-7 items-center rounded-lg bg-accent/10 px-2.5 text-[12px] font-medium text-accent transition hover:bg-accent/15 disabled:opacity-50"
        >
          {discover.venueLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : t('writePaperDiscoverVenueGo')}
        </button>
      </div>
      {discover.venueError ? (
        <p className="mb-2 rounded-lg border border-red-200/70 bg-red-50/80 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          {discover.venueError}
        </p>
      ) : null}
      <ul className="space-y-2">
        {discover.venueItems.map((item: PaperVenueItem) => (
          <li key={item.coolId} className="rounded-xl border border-ds-border-muted bg-ds-card/60 p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium leading-5 text-ds-ink">{item.title}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-ds-faint">
                  {item.authors.slice(0, 4).join(', ')}
                </p>
              </div>
              <ImportButton input={item.coolId} workspaceRoot={workspaceRoot} t={t} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
