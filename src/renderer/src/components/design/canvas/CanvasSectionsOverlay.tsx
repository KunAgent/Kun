import { memo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  moveSection,
  removeSection,
  renameSection,
  sectionBounds,
  toggleSectionCollapsed
} from '../../../design/canvas/canvas-sections'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import type { CanvasSection } from '../../../design/canvas/canvas-types'

/** Space kept above a section's boards for their own name strips. */
const NAME_STRIP_CLEARANCE = 34
const HEADER_HEIGHT = 40

type Props = {
  readOnly?: boolean
  onAskKun?: (prompt: string) => void
}

function SectionHeader({
  section,
  left,
  top,
  width,
  zoom,
  readOnly,
  onAskKun
}: {
  section: CanvasSection
  left: number
  top: number
  width: number
  zoom: number
  readOnly?: boolean
  onAskKun?: (prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [editing, setEditing] = useState(false)
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const title = section.title || t('canvasSectionUntitled')
  const count = section.memberIds.length

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (readOnly || editing || event.button !== 0) return
    if ((event.target as HTMLElement).closest('button,input')) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, moved: false }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    const dx = (event.clientX - drag.x) / zoom
    const dy = (event.clientY - drag.y) / zoom
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 3) return
    drag.moved = true
    drag.x = event.clientX
    drag.y = event.clientY
    moveSection(section.id, dx, dy)
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      className="ds-no-drag group pointer-events-auto absolute z-[15] flex items-center gap-2"
      style={{ left, top, width, height: HEADER_HEIGHT, cursor: readOnly ? 'default' : 'grab' }}
      data-canvas-section={section.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <button
        type="button"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
        onClick={() => toggleSectionCollapsed(section.id)}
        aria-label={t(section.collapsed ? 'canvasSectionExpand' : 'canvasSectionCollapse')}
        aria-expanded={!section.collapsed}
      >
        {section.collapsed
          ? <ChevronRight className="h-4 w-4" strokeWidth={2} />
          : <ChevronDown className="h-4 w-4" strokeWidth={2} />}
      </button>
      {editing ? (
        <input
          autoFocus
          defaultValue={section.title}
          className="min-w-0 flex-1 rounded-[6px] border border-accent bg-ds-surface px-1.5 text-[18px] font-bold leading-7 text-ds-ink outline-none"
          aria-label={t('canvasSectionRename')}
          onBlur={(event) => {
            renameSection(section.id, event.currentTarget.value)
            setEditing(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span
          className="min-w-0 truncate text-[18px] font-bold leading-7 text-ds-ink"
          title={title}
          onDoubleClick={() => { if (!readOnly) setEditing(true) }}
        >
          {title}
        </span>
      )}
      <span className="shrink-0 text-[12px] text-ds-muted">{t('canvasSectionCount', { count })}</span>
      {readOnly ? null : (
        <span className="ml-1 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {onAskKun ? (
            <button
              type="button"
              className="inline-flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[12px] text-accent hover:bg-ds-hover"
              onClick={() => onAskKun(t('canvasSectionAskKunPrompt', { title }))}
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
              {t('canvasSectionAskKun')}
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
            onClick={() => removeSection(section.id)}
            aria-label={t('canvasSectionUngroup')}
            title={t('canvasSectionUngroup')}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
        </span>
      )}
    </div>
  )
}

function CanvasSectionsOverlayInner({ readOnly, onAskKun }: Props): ReactElement | null {
  const doc = useCanvasShapeStore((s) => s.document)
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const containerWidth = useCanvasViewportStore((s) => s.containerWidth)
  const sections = doc.sections
  if (!sections || sections.length === 0) return null
  const zoom = containerWidth / vbox.width
  return (
    <>
      {sections.map((section) => {
        const bounds = sectionBounds(doc, section)
        if (!bounds) return null
        const left = (bounds.x - vbox.x) * zoom
        const top = (bounds.y - vbox.y) * zoom - NAME_STRIP_CLEARANCE - HEADER_HEIGHT
        const width = Math.max(180, bounds.width * zoom)
        return (
          <div key={section.id}>
            {section.collapsed ? (
              <div
                className="pointer-events-none absolute rounded-[10px] border border-dashed border-ds-border bg-ds-hover/40"
                style={{ left, top: (bounds.y - vbox.y) * zoom, width: bounds.width * zoom, height: bounds.height * zoom }}
              />
            ) : null}
            <SectionHeader
              section={section}
              left={left}
              top={top}
              width={width}
              zoom={zoom}
              readOnly={readOnly}
              onAskKun={onAskKun}
            />
          </div>
        )
      })}
    </>
  )
}

export const CanvasSectionsOverlay = memo(CanvasSectionsOverlayInner)
