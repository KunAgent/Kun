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
import type { CanvasSection, Rect } from '../../../design/canvas/canvas-types'
import { htmlFrameCanvasScreenTransform } from './HtmlFrameOverlay'
import { HTML_FRAME_OVERVIEW_ZOOM } from './html-frame/html-frame-preview-budget'

export function canvasSectionHeaderLayout(bounds: Rect, vbox: Rect, containerWidth: number, containerHeight: number) {
  const transform = htmlFrameCanvasScreenTransform({ vbox, containerWidth, containerHeight })
  const compact = transform.scale < HTML_FRAME_OVERVIEW_ZOOM
  const height = compact ? 20 : 32
  const clearance = compact ? 4 : 30
  return {
    left: transform.offsetX + (bounds.x - vbox.x) * transform.scale,
    top: transform.offsetY + (bounds.y - vbox.y) * transform.scale - clearance - height,
    width: Math.max(0, bounds.width * transform.scale),
    height,
    compact,
    zoom: transform.scale,
    boardTop: transform.offsetY + (bounds.y - vbox.y) * transform.scale
  }
}

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
  height,
  compact,
  readOnly,
  onAskKun
}: {
  section: CanvasSection
  left: number
  top: number
  width: number
  zoom: number
  height: number
  compact: boolean
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
      className={`ds-no-drag group pointer-events-auto absolute z-[15] flex items-center ${compact ? 'gap-1' : 'gap-2'}`}
      style={{ left, top, width, height, cursor: readOnly ? 'default' : 'grab' }}
      data-canvas-section={section.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <button
        type="button"
        className={`inline-flex shrink-0 items-center justify-center rounded-[6px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink ${compact ? 'h-5 w-5' : 'h-6 w-6'}`}
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
          className="min-w-0 flex-1 rounded-[6px] border border-accent bg-ds-card px-1.5 font-semibold text-ds-ink outline-none"
          style={{ fontSize: compact ? 11 : 16, lineHeight: compact ? '18px' : '28px' }}
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
          className="min-w-0 flex-1 truncate font-semibold text-ds-ink"
          style={{ fontSize: compact ? 11 : 16, lineHeight: compact ? '18px' : '28px' }}
          title={title}
          onDoubleClick={() => { if (!readOnly) setEditing(true) }}
        >
          {title}
        </span>
      )}
      {width >= (compact ? 180 : 260) ? (
        <span className={`shrink-0 text-ds-muted ${compact ? 'text-[10px]' : 'text-[12px]'}`}>{t('canvasSectionCount', { count })}</span>
      ) : null}
      {readOnly || compact || editing || width < 300 ? null : (
        <span className="absolute right-0 flex items-center gap-1 rounded bg-ds-card opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
  const containerHeight = useCanvasViewportStore((s) => s.containerHeight)
  const sections = doc.sections
  if (!sections || sections.length === 0) return null
  return (
    <>
      {sections.map((section) => {
        const bounds = sectionBounds(doc, section)
        if (!bounds) return null
        const layout = canvasSectionHeaderLayout(bounds, vbox, containerWidth, containerHeight)
        const { left, width, zoom, boardTop, ...headerLayout } = layout
        if (width < 28 || left + width < 0 || left > containerWidth || layout.top + layout.height < 0 || layout.top > containerHeight) return null
        return (
          <div key={section.id}>
            {section.collapsed ? (
              <div
                className="pointer-events-none absolute rounded-[10px] border border-dashed border-ds-border bg-ds-hover/40"
                style={{ left, top: boardTop, width, height: bounds.height * zoom }}
              />
            ) : null}
            <SectionHeader
              section={section}
              left={left}
              {...headerLayout}
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
