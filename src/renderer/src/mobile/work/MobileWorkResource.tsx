import { ArrowLeft, MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import type { WorkResourceView } from '../navigation/mobile-page'
import './mobile-work-resource.css'

type MobileWorkResourceProps = {
  title: string
  statusLabel: string
  view: WorkResourceView
  labels: Record<WorkResourceView, string> & { back: string; more: string }
  supportedViews: readonly WorkResourceView[]
  content: ReactNode
  onBack: () => void
  onMenu: (() => void) | null
  onView: (view: WorkResourceView) => void
}

/** A single mobile work surface; content still comes from the existing editor/preview/review engines. */
export function MobileWorkResource(props: MobileWorkResourceProps) {
  const { title, statusLabel, view, labels, supportedViews, content, onBack, onMenu, onView } = props
  return <section className="kun-mobile-work-resource">
    <header>
      <button type="button" aria-label={labels.back} onClick={onBack}><ArrowLeft aria-hidden /></button>
      <div><h1>{title}</h1><p>{statusLabel}</p></div>
      {onMenu ? <button type="button" aria-label={labels.more} onClick={onMenu}><MoreHorizontal aria-hidden /></button> : <span aria-hidden />}
    </header>
    <nav aria-label={title}>{supportedViews.map((candidate) => <button key={candidate} type="button"
      aria-current={view === candidate ? 'page' : undefined} onClick={() => onView(candidate)}>{labels[candidate]}</button>)}</nav>
    <div className="kun-mobile-work-resource-content" data-work-view={view}>{content}</div>
  </section>
}
