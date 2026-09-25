import { useEffect, useState, type ReactElement } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Compass,
  ExternalLink,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  RotateCw,
  Rss,
  Trophy,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { openPaperViewTab } from '../../paper/paper-view'
import { newPaperRequestId, usePaperStore } from '../../write/paper/paper-store'
import type {
  PaperArxivTodayItem,
  PaperFeedItem,
  PaperVenueItem
} from '@shared/paper/paper-library-types'

export type PaperDiscoverSource = 'arxiv' | 'feeds' | 'venue'

const SOURCE_ICONS: Record<PaperDiscoverSource, ReactElement> = {
  arxiv: <Newspaper className="h-4 w-4" strokeWidth={1.8} />,
  feeds: <Rss className="h-4 w-4" strokeWidth={1.8} />,
  venue: <Trophy className="h-4 w-4" strokeWidth={1.8} />
}

/**
 * Discover virtual tab (U4/U7): one browser-like surface per source —
 * arXiv today, feed subscriptions, or a papers.cool venue listing — with a
 * pseudo address bar (back → library tab, refresh, current source label).
 */
export function PaperDiscoverView({ source }: { source?: PaperDiscoverSource }): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const feeds = useWriteWorkspaceStore((s) => s.paperMode.discover.feeds)
  const activeFeedId = usePaperModeStore((s) => s.discover.activeFeedId)
  const feedTitle = feeds.find((feed) => feed.id === activeFeedId)?.title ?? ''
  const venue = usePaperModeStore((s) => s.discover.venue)
  const effectiveSource = source ?? 'arxiv'
  const [reloadKey, setReloadKey] = useState(0)

  const addressLabel =
    effectiveSource === 'arxiv'
      ? 'arxiv.org · new'
      : effectiveSource === 'feeds'
        ? feedTitle || t('writePaperDiscoverTab_feeds')
        : `papers.cool · ${venue || 'venue'}`

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-ds-border-muted px-3 py-2">
        <button
          type="button"
          onClick={() => openPaperViewTab('library')}
          title={t('writePaperDiscoverBack')}
          aria-label={t('writePaperDiscoverBack')}
          className="write-pdf-icon-button shrink-0"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={() => setReloadKey((value) => value + 1)}
          title={t('writePaperDiscoverRefresh')}
          aria-label={t('writePaperDiscoverRefresh')}
          className="write-pdf-icon-button shrink-0"
        >
          <RotateCw className="h-3.5 w-3.5" strokeWidth={1.9} />
        </button>
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border border-ds-border-muted bg-ds-subtle px-3 dark:bg-white/[0.05]">
          <span className="shrink-0 text-accent">{SOURCE_ICONS[effectiveSource]}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ds-muted">
            {addressLabel}
          </span>
          <Compass className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {effectiveSource === 'arxiv' ? (
          <ArxivTodayPane workspaceRoot={workspaceRoot} reloadKey={reloadKey} />
        ) : effectiveSource === 'feeds' ? (
          <FeedsPane workspaceRoot={workspaceRoot} reloadKey={reloadKey} />
        ) : (
          <VenuePane workspaceRoot={workspaceRoot} reloadKey={reloadKey} />
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
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ds-border px-2 py-1 text-[11.5px] font-medium text-ds-muted transition hover:border-accent/40 hover:bg-accent/[0.06] hover:text-accent disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
      {t('writePaperImport')}
    </button>
  )
}

/** Abstract with an expand/collapse affordance (site-like card body). */
function ExpandableAbstract({ text }: { text: string }): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1.5">
      <p
        className={`text-[11.5px] leading-[1.45] text-ds-muted ${open ? '' : 'line-clamp-3'}`}
      >
        {text}
      </p>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-0.5 inline-flex items-center gap-0.5 text-[10.5px] font-medium text-accent transition hover:brightness-110"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {open ? t('writePaperDiscoverShowLess') : t('writePaperDiscoverShowMore')}
      </button>
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
      <div className="mb-3 flex items-center gap-2">
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
          title={t('writePaperDiscoverRefresh')}
          aria-label={t('writePaperDiscoverRefresh')}
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
    <li className="rounded-xl border border-ds-border-muted bg-ds-card/60 p-3.5 transition hover:border-ds-border hover:bg-ds-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-5 text-ds-ink">{item.title}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-accent/80">
            {item.authors.slice(0, 4).join(', ')}
          </p>
          <p className="mt-0.5 truncate text-[10.5px] text-ds-faint">
            {[item.arxivId, item.publishedAt, ...item.categories].filter(Boolean).join(' · ')}
          </p>
        </div>
        {item.relevance > 0 ? (
          <span className="shrink-0 rounded-full bg-accent/[0.08] px-1.5 py-px text-[10px] text-accent">
            {Math.round(item.relevance * 100)}%
          </span>
        ) : null}
      </div>
      {item.abstract ? <ExpandableAbstract text={item.abstract} /> : null}
      <div className="mt-2 flex items-center gap-1.5">
        <a
          className="inline-flex items-center gap-1 rounded-full border border-ds-border px-2 py-0.5 text-[10.5px] font-medium text-ds-muted transition hover:border-accent/40 hover:text-accent"
          href="#"
          onClick={(event) => {
            event.preventDefault()
            void window.kunGui?.openExternal?.(`https://arxiv.org/abs/${item.arxivId}`)
          }}
        >
          <ExternalLink className="h-3 w-3" />
          arXiv
        </a>
        <a
          className="inline-flex items-center gap-1 rounded-full border border-ds-border px-2 py-0.5 text-[10.5px] font-medium text-ds-muted transition hover:border-accent/40 hover:text-accent"
          href="#"
          onClick={(event) => {
            event.preventDefault()
            void window.kunGui?.openExternal?.(`https://arxiv.org/pdf/${item.arxivId}`)
          }}
        >
          PDF
        </a>
        <span className="flex-1" />
        <ImportButton input={item.arxivId} workspaceRoot={workspaceRoot} t={t} />
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

  useEffect(() => {
    if (reloadKey <= 0) return
    const feed = feeds.find((item) => item.id === discover.activeFeedId) ?? feeds[0]
    if (feed) loadFeed(feed.id, feed.url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  const activeItems = discover.feedItems[discover.activeFeedId] ?? []

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
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
      <ul className="space-y-2.5">
        {activeItems.map((item: PaperFeedItem) => (
          <li
            key={item.url}
            className="rounded-xl border border-ds-border-muted bg-ds-card/60 p-3.5 transition hover:border-ds-border hover:bg-ds-card"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold leading-5 text-ds-ink">{item.title}</p>
                <p className="mt-0.5 text-[10.5px] text-ds-faint">{item.publishedAt ?? ''}</p>
              </div>
            </div>
            {item.summary ? <ExpandableAbstract text={item.summary} /> : null}
            <div className="mt-2 flex items-center gap-1.5">
              {item.url ? (
                <a
                  className="inline-flex items-center gap-1 rounded-full border border-ds-border px-2 py-0.5 text-[10.5px] font-medium text-ds-muted transition hover:border-accent/40 hover:text-accent"
                  href="#"
                  onClick={(event) => {
                    event.preventDefault()
                    void window.kunGui?.openExternal?.(item.url)
                  }}
                >
                  <ExternalLink className="h-3 w-3" />
                  {t('writePaperDiscoverOpenLink')}
                </a>
              ) : null}
              <span className="flex-1" />
              {item.arxivId || item.doi ? (
                <ImportButton
                  input={item.arxivId ?? item.doi ?? ''}
                  workspaceRoot={workspaceRoot}
                  t={t}
                />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function VenuePane({
  workspaceRoot,
  reloadKey
}: {
  workspaceRoot: string
  reloadKey: number
}): ReactElement {
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

  useEffect(() => {
    if (reloadKey > 0) loadVenue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
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
      <ul className="space-y-2.5">
        {discover.venueItems.map((item: PaperVenueItem) => (
          <li
            key={item.coolId}
            className="rounded-xl border border-ds-border-muted bg-ds-card/60 p-3.5 transition hover:border-ds-border hover:bg-ds-card"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold leading-5 text-ds-ink">{item.title}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-accent/80">
                  {item.authors.slice(0, 4).join(', ')}
                </p>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <a
                className="inline-flex items-center gap-1 rounded-full border border-ds-border px-2 py-0.5 text-[10.5px] font-medium text-ds-muted transition hover:border-accent/40 hover:text-accent"
                href="#"
                onClick={(event) => {
                  event.preventDefault()
                  void window.kunGui?.openExternal?.(`https://papers.cool/venue/${item.coolId}`)
                }}
              >
                <ExternalLink className="h-3 w-3" />
                papers.cool
              </a>
              <span className="flex-1" />
              <ImportButton input={item.coolId} workspaceRoot={workspaceRoot} t={t} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
