import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Focus,
  Grid3X3,
  Magnet,
  Maximize,
  Redo2,
  ScanSearch,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'
import {
  zoomCanvasToContent,
  zoomCanvasToEditableSelection
} from '../../../design/canvas/canvas-focus'

const isMac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')
const MOD = isMac ? '⌘' : 'Ctrl+'

function CanvasZoomBarInner() {
  const { t } = useTranslation('common')
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const containerWidth = useCanvasViewportStore((s) => s.containerWidth)
  const gridVisible = useCanvasViewportStore((s) => s.gridVisible)
  const snapEnabled = useCanvasViewportStore((s) => s.snapEnabled)
  const undoCount = useCanvasUndoStore((s) => s.undoStack.length)
  const redoCount = useCanvasUndoStore((s) => s.redoStack.length)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const zoom = containerWidth / vbox.width
  const zoomPercent = Math.round(zoom * 100)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const zoomIn = useCallback(() => {
    const s = useCanvasViewportStore.getState()
    const cx = s.vbox.x + s.vbox.width / 2
    const cy = s.vbox.y + s.vbox.height / 2
    s.zoomTo(1.2, { x: cx, y: cy })
  }, [])

  const zoomOut = useCallback(() => {
    const s = useCanvasViewportStore.getState()
    const cx = s.vbox.x + s.vbox.width / 2
    const cy = s.vbox.y + s.vbox.height / 2
    s.zoomTo(1 / 1.2, { x: cx, y: cy })
  }, [])

  const zoomTo100 = useCallback(() => {
    useCanvasViewportStore.getState().resetView()
  }, [])

  const zoomToFit = useCallback(() => {
    zoomCanvasToContent()
  }, [])

  const zoomToSelection = useCallback(() => {
    zoomCanvasToEditableSelection()
  }, [])
  const toggleGrid = useCallback(() => {
    useCanvasViewportStore.getState().toggleGrid()
  }, [])
  const toggleSnap = useCallback(() => {
    useCanvasViewportStore.getState().toggleSnap()
  }, [])

  const undo = useCallback(() => useCanvasShapeStore.getState().undo(), [])
  const redo = useCallback(() => useCanvasShapeStore.getState().redo(), [])

  const btnBase =
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-35'
  const btnNormal = 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink dark:hover:bg-white/10'
  const pill =
    'rounded-full border border-ds-border bg-white/82 shadow-[0_12px_34px_rgba(20,47,95,0.10)] backdrop-blur-2xl dark:bg-ds-card/84 dark:shadow-none'

  const menuItems: { labelKey: string; shortcut: string; icon: typeof ZoomIn; action: () => void }[] = [
    { labelKey: 'canvasZoomIn', shortcut: `${MOD}+`, icon: ZoomIn, action: zoomIn },
    { labelKey: 'canvasZoomOut', shortcut: `${MOD}-`, icon: ZoomOut, action: zoomOut },
    { labelKey: 'canvasZoomTo100', shortcut: '⇧0', icon: Maximize, action: zoomTo100 },
    { labelKey: 'canvasZoomFit', shortcut: '⇧1', icon: Focus, action: zoomToFit },
    { labelKey: 'canvasZoomToSelection', shortcut: '⇧2', icon: ScanSearch, action: zoomToSelection }
  ]
  const toggleItems: {
    labelKey: string
    icon: typeof Grid3X3
    active: boolean
    action: () => void
  }[] = [
    { labelKey: 'canvasGridToggle', icon: Grid3X3, active: gridVisible, action: toggleGrid },
    { labelKey: 'canvasSnap', icon: Magnet, active: snapEnabled, action: toggleSnap }
  ]

  return (
    <div ref={menuRef} className="relative">
      {menuOpen && (
        <div
          className={`absolute bottom-full right-0 mb-2 w-52 overflow-hidden rounded-xl ${pill} py-1`}
        >
          {menuItems.map((item) => (
            <button
              key={item.labelKey}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-ds-ink transition-colors hover:bg-ds-hover dark:hover:bg-white/8"
              onClick={() => {
                item.action()
                setMenuOpen(false)
              }}
            >
              <item.icon className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.8} />
              <span className="flex-1 text-left">{t(item.labelKey)}</span>
              <kbd className="shrink-0 text-[11px] text-ds-faint">{item.shortcut}</kbd>
            </button>
          ))}
          <div className="my-1 h-px bg-ds-border-muted/80" />
          {toggleItems.map((item) => (
            <button
              key={item.labelKey}
              type="button"
              aria-pressed={item.active}
              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-ds-ink transition-colors hover:bg-ds-hover dark:hover:bg-white/8"
              onClick={() => {
                item.action()
              }}
            >
              <item.icon className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.8} />
              <span className="flex-1 text-left">{t(item.labelKey)}</span>
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  item.active
                    ? 'border-accent bg-accent text-white'
                    : 'border-ds-border-muted text-transparent'
                }`}
                aria-hidden="true"
              >
                <Check className="h-2.5 w-2.5" strokeWidth={2.4} />
              </span>
            </button>
          ))}
        </div>
      )}

      <div className={`design-canvas-zoom-bar flex items-center gap-1 px-1.5 py-1 ${pill}`}>
        <button
          type="button"
          className={`${btnBase} ${btnNormal}`}
          onClick={undo}
          disabled={undoCount === 0}
          title={`${t('canvasUndo')} (${MOD}Z)`}
          aria-label={t('canvasUndo')}
        >
          <Undo2 className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={`${btnBase} ${btnNormal}`}
          onClick={redo}
          disabled={redoCount === 0}
          title={`${t('canvasRedo')} (${MOD}⇧Z)`}
          aria-label={t('canvasRedo')}
        >
          <Redo2 className="h-4 w-4" strokeWidth={1.8} />
        </button>

        <button
          type="button"
          className="inline-flex h-7 min-w-[2.75rem] items-center justify-center rounded-lg px-2 text-[12px] font-semibold tabular-nums text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink dark:hover:bg-white/10"
          onClick={() => setMenuOpen((o) => !o)}
          title={t('canvasZoomIn')}
        >
          {zoomPercent}%
        </button>
      </div>
    </div>
  )
}

export const CanvasZoomBar = memo(CanvasZoomBarInner)
