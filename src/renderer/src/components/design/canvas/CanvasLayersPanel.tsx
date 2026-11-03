import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Square,
  Circle,
  Type,
  Image,
  Hash,
  Group,
  ArrowUpRight,
  Slash,
  Pencil,
  Monitor,
  Shapes,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { deleteCanvasLayers } from '../../../design/canvas/canvas-layer-actions'
import { flattenCanvasLayerRows } from '../../../design/canvas/canvas-layer-tree'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import {
  isHtmlFrame,
  isSvgFrame,
  type CanvasShape,
  type ShapeType
} from '../../../design/canvas/canvas-types'

const TYPE_ICONS: Record<ShapeType, typeof Square> = {
  rect: Square,
  ellipse: Circle,
  text: Type,
  image: Image,
  frame: Hash,
  group: Group,
  arrow: ArrowUpRight,
  line: Slash,
  draw: Pencil
}

export function canvasLayerIcon(shape: CanvasShape): typeof Square {
  if (isHtmlFrame(shape)) return Monitor
  if (isSvgFrame(shape)) return Shapes
  return TYPE_ICONS[shape.type] ?? Square
}

/** Short quoted preview of a text layer's content, shown after its name. */
export function canvasLayerTextPreview(shape: CanvasShape, maxLength = 48): string {
  if (shape.type !== 'text') return ''
  const text = (shape.textContent ?? '').replace(/\s+/gu, ' ').trim()
  if (!text || text === shape.name.trim()) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

const rowAction =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ds-faint transition hover:bg-ds-border-muted hover:text-ds-ink'

function LayerRow({
  shape,
  depth,
  hasChildren,
  collapsed,
  onToggleCollapsed,
  labels
}: {
  shape: CanvasShape
  depth: number
  hasChildren: boolean
  collapsed: boolean
  onToggleCollapsed: (id: string) => void
  labels: {
    collapse: string
    visibility: string
    lock: string
    delete: string
  }
}) {
  const selected = useCanvasSelectionStore((s) => s.selectedIds.has(shape.id))
  const select = useCanvasSelectionStore((s) => s.select)
  const toggle = useCanvasSelectionStore((s) => s.toggle)
  const updateShape = useCanvasShapeStore((s) => s.updateShape)
  const rowRef = useRef<HTMLDivElement | null>(null)

  const Icon = canvasLayerIcon(shape)
  const preview = canvasLayerTextPreview(shape)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const commitRename = (): void => {
    const name = draft.trim()
    if (name) updateShape(shape.id, { name })
    setRenaming(false)
  }

  return (
    <div
      ref={rowRef}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? !collapsed : undefined}
      data-canvas-layer-row={shape.id}
      className={`group flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] pr-1.5 text-[13px] transition-colors ${
        selected ? 'bg-ds-hover text-ds-ink' : 'text-ds-ink hover:bg-ds-hover'
      } ${shape.visible ? '' : 'opacity-55'}`}
      style={{ paddingLeft: `${6 + depth * 18}px` }}
      onClick={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) toggle(shape.id)
        else select([shape.id])
      }}
      onDoubleClick={() => {
        setDraft(shape.name)
        setRenaming(true)
      }}
    >
      {hasChildren ? (
        <button
          type="button"
          title={labels.collapse}
          aria-label={labels.collapse}
          className="flex h-5 w-4 shrink-0 items-center justify-center text-ds-faint hover:text-ds-ink"
          onClick={(e) => {
            e.stopPropagation()
            onToggleCollapsed(shape.id)
          }}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.9} />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.9} />
          )}
        </button>
      ) : (
        <span className="h-4 w-4 shrink-0" />
      )}
      <Icon className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.7} />
      {renaming ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setRenaming(false)
          }}
          className="min-w-0 flex-1 rounded-[6px] bg-ds-elevated px-1.5 py-0.5 text-[13px] outline-none ring-1 ring-accent-tint/50"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">
          {shape.name}
          {preview ? <span className="ml-1.5 text-ds-muted">“{preview}”</span> : null}
        </span>
      )}
      <span className={`flex shrink-0 items-center gap-0.5 ${shape.visible && !shape.locked ? 'opacity-0 group-hover:opacity-100' : ''}`}>
        <button
          type="button"
          title={labels.visibility}
          aria-label={labels.visibility}
          aria-pressed={shape.visible}
          className={rowAction}
          onClick={(e) => {
            e.stopPropagation()
            updateShape(shape.id, { visible: !shape.visible })
          }}
        >
          {shape.visible ? <Eye className="h-3.5 w-3.5" strokeWidth={1.6} /> : <EyeOff className="h-3.5 w-3.5" strokeWidth={1.6} />}
        </button>
        <button
          type="button"
          title={labels.lock}
          aria-label={labels.lock}
          aria-pressed={shape.locked}
          className={rowAction}
          onClick={(e) => {
            e.stopPropagation()
            updateShape(shape.id, { locked: !shape.locked })
          }}
        >
          {shape.locked ? <Lock className="h-3.5 w-3.5" strokeWidth={1.6} /> : <Unlock className="h-3.5 w-3.5" strokeWidth={1.6} />}
        </button>
        <button
          type="button"
          title={labels.delete}
          aria-label={labels.delete}
          className={`${rowAction} hover:text-ds-danger`}
          onClick={(e) => {
            e.stopPropagation()
            deleteCanvasLayers([shape.id])
          }}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
        </button>
      </span>
    </div>
  )
}

function CanvasLayersPanelInner() {
  const document = useCanvasShapeStore((s) => s.document)
  const { t } = useTranslation('common')
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())

  const rows = useMemo(
    () => flattenCanvasLayerRows(document, collapsedIds),
    [document, collapsedIds]
  )
  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const root = document.objects[document.rootId]
  if (!root) return null

  return (
    <div role="tree" aria-label={t('canvasInspectorTabOutline')} className="flex flex-col gap-px px-2 py-2">
      {rows.map((row) => {
        const child = document.objects[row.id]
        if (!child) return null
        return (
          <LayerRow
            key={row.id}
            shape={child}
            depth={row.depth}
            hasChildren={row.hasChildren}
            collapsed={row.collapsed}
            onToggleCollapsed={toggleCollapsed}
            labels={{
              collapse: t(row.collapsed ? 'canvasLayerExpand' : 'canvasLayerCollapse'),
              visibility: t(child.visible ? 'canvasLayerHide' : 'canvasLayerShow'),
              lock: t(child.locked ? 'canvasLayerUnlock' : 'canvasLayerLock'),
              delete: t('canvasLayerDelete')
            }}
          />
        )
      })}
      {rows.length === 0 && (
        <div className="px-2 py-6 text-center text-[12px] text-ds-faint">
          {t('canvasLayersEmpty')}
        </div>
      )}
    </div>
  )
}

export const CanvasLayersPanel = memo(CanvasLayersPanelInner)
