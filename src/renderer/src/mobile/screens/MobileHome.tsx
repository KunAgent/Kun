import { ArrowLeft, MoreHorizontal, Plus, Search, Settings } from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import './mobile-home.css'
import { MobileLoadingDots } from '../lib/MobileLoading'

export type MobileThreadActivity = {
  kind: 'running' | 'awaiting-input' | 'failed' | 'unread' | 'scheduled'
  label: string
}

export type MobileHomeLabels = {
  title: string
  workspace: string
  search: string
  newConversation: string
  settings: string
  more: string
  loadMore: string
  retry: string
  empty: string
  loading: string
  back: string
}

export type MobileHomeProps = {
  labels: MobileHomeLabels
  threads: readonly NormalizedThread[]
  search: string
  loading: boolean
  error: string | null
  hasMore: boolean
  onSearch: (value: string) => void
  onOpenThread: (id: string) => void
  onThreadMenu: ((id: string) => void) | null
  onWorkspace: (() => void) | null
  onNewConversation: () => void
  onSettings: () => void
  onLoadMore: () => void
  onRetry: () => void
  /** Live activity badge for a row; null renders no badge. */
  activityOf?: (thread: NormalizedThread) => MobileThreadActivity | null
  /** Compact timestamp for a row; defaults to a locale date. */
  timeLabel?: (thread: NormalizedThread) => string
}

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5]

function defaultTimeLabel(thread: NormalizedThread): string {
  return Number.isNaN(Date.parse(thread.updatedAt)) ? '' : new Date(thread.updatedAt).toLocaleDateString()
}

/** Presentation only: pagination, filtering and ownership remain in the shared store. */
export function MobileHome({
  labels, threads, search, loading, error, hasMore, onSearch, onOpenThread,
  onThreadMenu, onWorkspace, onNewConversation, onSettings, onLoadMore, onRetry,
  activityOf, timeLabel = defaultTimeLabel
}: MobileHomeProps) {
  const showSkeletons = loading && threads.length === 0 && !error
  return (
    <section className="kun-mobile-home" aria-label={labels.title}>
      <header className="kun-mobile-home-header">
        {onWorkspace ? (
          <button type="button" className="kun-mobile-back" onClick={onWorkspace}>
            <ArrowLeft size={20} aria-hidden />
            <span>{labels.workspace}</span>
          </button>
        ) : <span />}
        <div className="kun-mobile-home-actions">
          <button type="button" className="kun-mobile-icon-button" onClick={onSettings} aria-label={labels.settings}>
            <Settings size={20} aria-hidden />
          </button>
          <button type="button" className="kun-mobile-icon-button" onClick={onNewConversation} disabled={loading} aria-label={labels.newConversation}>
            <Plus size={22} aria-hidden />
          </button>
        </div>
      </header>
      <h1>{labels.title}</h1>
      <label className="kun-mobile-search">
        <Search size={18} aria-hidden />
        <input type="search" value={search} onChange={(event) => onSearch(event.target.value)}
          aria-label={labels.search} placeholder={labels.search} />
      </label>
      <div className="kun-mobile-home-list" aria-busy={loading}
        onScroll={(event) => {
          const el = event.currentTarget
          if (hasMore && !loading && el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
            onLoadMore()
          }
        }}>
        {error ? <div role="alert" className="kun-mobile-home-state">
          <p>{error}</p><button type="button" disabled={loading} onClick={onRetry}>{labels.retry}</button>
        </div> : null}
        {!error && !threads.length ? <p
          className={showSkeletons ? 'kun-mobile-visually-hidden' : 'kun-mobile-home-state'}
          role="status">
          {loading ? labels.loading : labels.empty}
        </p> : null}
        <ul>
          {showSkeletons
            ? SKELETON_ROWS.map((row) => (
              <li key={row} className="kun-mobile-thread kun-mobile-thread-skeleton" aria-hidden>
                <span className="kun-mobile-thread-open">
                  <span className="kun-mobile-skeleton-line" data-size="lg" />
                  <span className="kun-mobile-skeleton-line" data-size="sm" />
                </span>
              </li>
            ))
            : threads.map((thread) => {
              const activity = activityOf?.(thread) ?? null
              return <li key={thread.id} className="kun-mobile-thread">
                <button type="button" className="kun-mobile-thread-open" onClick={() => onOpenThread(thread.id)}>
                  <span className="kun-mobile-thread-main">
                    <span className="kun-mobile-thread-title">{thread.title}</span>
                    <time dateTime={thread.updatedAt}>{timeLabel(thread)}</time>
                  </span>
                  <span className="kun-mobile-thread-meta">
                    {activity ? (
                      <span className="kun-mobile-activity" data-kind={activity.kind}>{activity.label}</span>
                    ) : null}
                    {/* No summary/preview means no second line — falling back to
                        the model name filled every row with "deepseek-chat". */}
                    {thread.summary || thread.preview ? (
                      <span className="kun-mobile-thread-preview">{thread.summary || thread.preview}</span>
                    ) : null}
                  </span>
                </button>
                {onThreadMenu ? <button type="button" className="kun-mobile-icon-button" onClick={() => onThreadMenu(thread.id)}
                  aria-label={`${labels.more}: ${thread.title}`}>
                  <MoreHorizontal size={20} aria-hidden />
                </button> : null}
              </li>
            })}
        </ul>
        {hasMore ? <button type="button" className="kun-mobile-load-more" disabled={loading} onClick={onLoadMore}>
          {loading ? <MobileLoadingDots /> : labels.loadMore}
        </button> : null}
      </div>
    </section>
  )
}

export function MobileBackButton({ label, onBack }: { label: string; onBack: () => void }) {
  return <button type="button" className="kun-mobile-icon-button" onClick={onBack} aria-label={label}>
    <ArrowLeft size={20} aria-hidden />
  </button>
}
