import { FileText, Folder, MoreHorizontal, Plus, Search, Shapes } from 'lucide-react'
import './mobile-work-home.css'
import { MobileLoadingState } from '../lib/MobileLoading'

export type MobileWorkResource = {
  key: string
  title: string
  detail: string
  kind: 'document' | 'whiteboard' | 'directory'
  status: 'saved' | 'dirty' | 'saving' | 'error' | 'review'
}
export type MobileWorkHomeProps = {
  workspaceLabel: string
  resources: readonly MobileWorkResource[]
  search: string
  loading: boolean
  error: string
  labels: { title: string; search: string; create: string; more: string; empty: string; loading: string; retry: string
    documents?: string; papers?: string; backFolder?: string; recent?: string; filesBoards?: string; loadMore?: string
    status?: Partial<Record<MobileWorkResource['status'], string>> }
  onWorkspace: (() => void) | null
  onSearch: (value: string) => void
  onOpen: (resource: MobileWorkResource) => void
  onMenu: ((resource: MobileWorkResource) => void) | null
  onCreate: (() => void) | null
  onRetry: () => void
  mode?: 'documents' | 'papers'
  onMode?: (mode: 'documents' | 'papers') => void
  onBackFolder?: () => void
  onLoadMore?: () => void
  hasMore?: boolean
  recent?: readonly MobileWorkResource[]
}

export function MobileWorkHome(props: MobileWorkHomeProps) {
  const { workspaceLabel, resources, search, loading, error, labels, onWorkspace, onSearch,
    onOpen, onMenu, onCreate, onRetry } = props
  return <section className="kun-mobile-work-home" aria-label={labels.title}>
    <header><div><h1>{labels.title}</h1>{onWorkspace ? <button type="button" onClick={onWorkspace}>{workspaceLabel}</button> : <span>{workspaceLabel}</span>}</div>
      {onCreate ? <button type="button" className="kun-mobile-work-icon" onClick={onCreate} aria-label={labels.create}><Plus aria-hidden /></button> : null}</header>
    {props.onMode ? <nav className="kun-mobile-work-tabs" aria-label={labels.title}>
      <button type="button" aria-current={props.mode === 'documents' ? 'page' : undefined} onClick={() => props.onMode?.('documents')}>{labels.documents ?? 'Documents'}</button>
      <button type="button" aria-current={props.mode === 'papers' ? 'page' : undefined} onClick={() => props.onMode?.('papers')}>{labels.papers ?? 'Papers'}</button>
    </nav> : null}
    {props.onBackFolder ? <button className="kun-mobile-work-folder-back" type="button" onClick={props.onBackFolder}>← {labels.backFolder ?? 'Back to parent folder'}</button> : null}
    <label className="kun-mobile-work-search"><Search size={18} aria-hidden />
      <input type="search" value={search} onChange={(event) => onSearch(event.target.value)} aria-label={labels.search} placeholder={labels.search} /></label>
    <div className="kun-mobile-work-list" aria-busy={loading}>
      {error ? <div role="alert"><p>{error}</p><button type="button" disabled={loading} onClick={onRetry}>{labels.retry}</button></div> : null}
      {!error && resources.length === 0 ? loading ? <MobileLoadingState label={labels.loading} />
        : <p role="status">{labels.empty}</p> : null}
      {props.recent?.length ? <><h2>{labels.recent ?? 'Recently opened'}</h2><ul>{props.recent.map((resource) => <li key={`recent-${resource.key}`}>
        <button type="button" className="kun-mobile-work-open" onClick={() => onOpen(resource)}><FileText aria-hidden />
          <span><strong>{resource.title}</strong><small>{resource.detail}</small></span></button>
      </li>)}</ul><h2>{labels.filesBoards ?? 'Files and whiteboards'}</h2></> : null}
      <ul>{resources.map((resource) => <li key={resource.key}>
        <button type="button" className="kun-mobile-work-open" onClick={() => onOpen(resource)}>
          {resource.kind === 'whiteboard' ? <Shapes aria-hidden /> : resource.kind === 'directory' ? <Folder aria-hidden /> : <FileText aria-hidden />}
          <span><strong>{resource.title}</strong><small>{resource.detail}</small></span>
          <span className={`kun-mobile-work-status is-${resource.status}`}>{labels.status?.[resource.status] ?? resource.status}</span>
        </button>
        {onMenu ? <button type="button" className="kun-mobile-work-icon" onClick={() => onMenu(resource)} aria-label={`${labels.more}: ${resource.title}`}>
          <MoreHorizontal aria-hidden /></button> : null}
      </li>)}</ul>
      {props.hasMore && props.onLoadMore ? <button type="button" className="kun-mobile-work-load-more" onClick={props.onLoadMore}>{labels.loadMore ?? 'Load more'}</button> : null}
    </div>
  </section>
}
