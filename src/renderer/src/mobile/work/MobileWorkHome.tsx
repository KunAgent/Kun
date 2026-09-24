import { FileText, MoreHorizontal, Plus, Search, Shapes } from 'lucide-react'
import './mobile-work-home.css'
import { MobileLoadingState } from '../lib/MobileLoading'

export type MobileWorkResource = {
  key: string
  title: string
  detail: string
  kind: 'document' | 'whiteboard'
  status: 'saved' | 'dirty' | 'saving' | 'error' | 'review'
}
export type MobileWorkHomeProps = {
  workspaceLabel: string
  resources: readonly MobileWorkResource[]
  search: string
  loading: boolean
  error: string
  labels: { title: string; search: string; create: string; more: string; empty: string; loading: string; retry: string }
  onWorkspace: (() => void) | null
  onSearch: (value: string) => void
  onOpen: (resource: MobileWorkResource) => void
  onMenu: ((resource: MobileWorkResource) => void) | null
  onCreate: (() => void) | null
  onRetry: () => void
}

export function MobileWorkHome(props: MobileWorkHomeProps) {
  const { workspaceLabel, resources, search, loading, error, labels, onWorkspace, onSearch,
    onOpen, onMenu, onCreate, onRetry } = props
  return <section className="kun-mobile-work-home" aria-label={labels.title}>
    <header><div><h1>{labels.title}</h1>{onWorkspace ? <button type="button" onClick={onWorkspace}>{workspaceLabel}</button> : <span>{workspaceLabel}</span>}</div>
      {onCreate ? <button type="button" className="kun-mobile-work-icon" onClick={onCreate} aria-label={labels.create}><Plus aria-hidden /></button> : null}</header>
    <label className="kun-mobile-work-search"><Search size={18} aria-hidden />
      <input type="search" value={search} onChange={(event) => onSearch(event.target.value)} aria-label={labels.search} placeholder={labels.search} /></label>
    <div className="kun-mobile-work-list" aria-busy={loading}>
      {error ? <div role="alert"><p>{error}</p><button type="button" disabled={loading} onClick={onRetry}>{labels.retry}</button></div> : null}
      {!error && resources.length === 0 ? loading ? <MobileLoadingState label={labels.loading} />
        : <p role="status">{labels.empty}</p> : null}
      <ul>{resources.map((resource) => <li key={resource.key}>
        <button type="button" className="kun-mobile-work-open" onClick={() => onOpen(resource)}>
          {resource.kind === 'whiteboard' ? <Shapes aria-hidden /> : <FileText aria-hidden />}
          <span><strong>{resource.title}</strong><small>{resource.detail}</small></span>
          <span className={`kun-mobile-work-status is-${resource.status}`}>{resource.status}</span>
        </button>
        {onMenu ? <button type="button" className="kun-mobile-work-icon" onClick={() => onMenu(resource)} aria-label={`${labels.more}: ${resource.title}`}>
          <MoreHorizontal aria-hidden /></button> : null}
      </li>)}</ul>
    </div>
  </section>
}
