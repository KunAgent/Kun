import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { MessageCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { layoutCommentGutter } from '../../../paper/comment-gutter-layout'
import { WorkAnnotationCard } from './WorkAnnotationCard'
import { useWorkAnnotationReview, type WorkAnnotationLayerProps } from './work-annotation-view'
import './work-annotations.css'

export type { WorkAnnotationView, WorkAnnotationMessageView, WorkAnnotationLayerProps } from './work-annotation-view'

export function WorkAnnotationLayer(props: WorkAnnotationLayerProps): ReactElement {
  const { annotations, documentKey, activeId, markerTops, onOpen } = props
  const { t } = useTranslation('common')
  const layer = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const owner = useRef(Symbol('focused annotation pane'))
  const [size, setSize] = useState({ height: 0, cardHeight: 0 })
  const active = annotations.find((note) => note.id === activeId)
  useLayoutEffect(() => {
    useWorkAnnotationReview.setState({ current: { owner: owner.current, documentKey, annotations, onOpen } })
  }, [documentKey, annotations, onOpen])
  useLayoutEffect(() => {
    const token = owner.current
    return () => {
      if (useWorkAnnotationReview.getState().current?.owner === token) {
        useWorkAnnotationReview.setState({ current: null })
      }
    }
  }, [])
  useLayoutEffect(() => {
    const pane = layer.current?.parentElement
    const measure = (): void => {
      const height = layer.current?.clientHeight ?? 0
      const cardHeight = frame.current?.offsetHeight ?? 0
      pane?.style.setProperty('--work-annotation-card-height', cardHeight + 'px')
      setSize((current) => current.height === height && current.cardHeight === cardHeight ? current : { height, cardHeight })
    }
    measure()
    if (typeof ResizeObserver === 'undefined' || !layer.current) return
    const observer = new ResizeObserver(measure)
    observer.observe(layer.current)
    if (frame.current) observer.observe(frame.current)
    return () => {
      observer.disconnect()
      pane?.style.removeProperty('--work-annotation-card-height')
    }
  }, [active?.id])

  const markers = annotations
    .filter((item) => !item.detached && !item.resolved && Number.isFinite(markerTops[item.id]) && markerTops[item.id] >= 0 && markerTops[item.id] < size.height)
    .sort((a, b) => markerTops[a.id] - markerTops[b.id])
  const tops = layoutCommentGutter({
    anchors: markers.map((item) => markerTops[item.id]),
    heights: markers.map(() => 24), containerHeight: size.height, gap: 3
  })
  const cardTop = Math.max(6, Math.min(markerTops[activeId ?? ''] ?? 8, size.height - size.cardHeight - 8))
  const close = (): void => {
    props.onClose()
    requestAnimationFrame(() => {
      const overlay = layer.current
      if (!overlay || !activeId) return
      const marker = Array.from(overlay.querySelectorAll<HTMLButtonElement>('[data-annotation-marker]'))
        .find((button) => button.dataset.annotationMarker === activeId)
      const target = marker ?? overlay.parentElement?.querySelector<HTMLElement>('.tiptap, .cm-content')
      target?.focus({ preventScroll: true })
    })
  }
  return (
    <div ref={layer} className="work-annotation-layer" data-selection-ignore="true" data-open={Boolean(active)}>
      {markers.map((item, i) => (
        <button key={item.id} className="work-annotation-marker" type="button" data-annotation-marker={item.id} style={{ top: tops[i] }}
          aria-expanded={item.id === activeId} title={item.quote}
          aria-label={t('writeAnnotationOpen', { quote: item.quote })} onClick={() => item.id === activeId ? close() : onOpen(item.id)}>
          <MessageCircle />
        </button>
      ))}
      {active && <div ref={frame} className="work-annotation-card-frame" style={{ '--work-annotation-top': `${cardTop}px` } as CSSProperties}>
        <WorkAnnotationCard key={documentKey + ':' + active.id} annotation={active}
          onClose={close} onSubmit={props.onSubmit} onResolve={props.onResolve} onReattach={props.onReattach}
          onPreview={props.onPreview} onRetry={props.onRetry} />
      </div>}
    </div>
  )
}
