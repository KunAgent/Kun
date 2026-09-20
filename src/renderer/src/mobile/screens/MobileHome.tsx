import { ArrowLeft, MoreHorizontal, Plus, Search, Settings } from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import './mobile-home.css'

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
  onThreadMenu: (id: string) => void
  onWorkspace: () => void
  onNewConversation: () => void
  onSettings: () => void
  onLoadMore: () => void
  onRetry: () => void
}

/** Presentation only: pagination, filtering and ownership remain in the shared store. */
export function MobileHome({
  labels, threads, search, loading, error, hasMore, onSearch, onOpenThread,
  onThreadMenu, onWorkspace, onNewConversation, onSettings, onLoadMore, onRetry
}: MobileHomeProps) {
  return (
    <section className="kun-mobile-home" aria-label={labels.title}>
      <header className="kun-mobile-home-header">
        <button type="button" className="kun-mobile-icon-button" onClick={onSettings} aria-label={labels.settings}>
          <Settings size={20} aria-hidden />
        </button>
        <button type="button" className="kun-mobile-workspace" onClick={onWorkspace}>
          {labels.workspace}
        </button>
        <button type="button" className="kun-mobile-icon-button" onClick={onNewConversation} aria-label={labels.newConversation}>
          <Plus size={22} aria-hidden />
        </button>
      </header>
      <h1>{labels.title}</h1>
      <label className="kun-mobile-search">
        <Search size={18} aria-hidden />
        <input type="search" value={search} onChange={(event) => onSearch(event.target.value)}
          aria-label={labels.search} placeholder={labels.search} />
      </label>
      <div className="kun-mobile-home-list" aria-busy={loading}>
        {error ? <div role="alert" className="kun-mobile-home-state">
          <p>{error}</p><button type="button" disabled={loading} onClick={onRetry}>{labels.retry}</button>
        </div> : null}
        {!error && !threads.length ? <p className="kun-mobile-home-state" role="status">
          {loading ? labels.loading : labels.empty}
        </p> : null}
        <ul>
          {threads.map((thread) => <li key={thread.id} className="kun-mobile-thread">
            <button type="button" className="kun-mobile-thread-open" onClick={() => onOpenThread(thread.id)}>
              <span className="kun-mobile-thread-title">{thread.title}</span>
              <span className="kun-mobile-thread-preview">{thread.summary || thread.preview || thread.model}</span>
              <time dateTime={thread.updatedAt}>{Number.isNaN(Date.parse(thread.updatedAt)) ? '' : new Date(thread.updatedAt).toLocaleDateString()}</time>
            </button>
            <button type="button" className="kun-mobile-icon-button" onClick={() => onThreadMenu(thread.id)}
              aria-label={`${labels.more}: ${thread.title}`}>
              <MoreHorizontal size={20} aria-hidden />
            </button>
          </li>)}
        </ul>
        {hasMore ? <button type="button" className="kun-mobile-load-more" disabled={loading} onClick={onLoadMore}>
          {loading ? labels.loading : labels.loadMore}
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
