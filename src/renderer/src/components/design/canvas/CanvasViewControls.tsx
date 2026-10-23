import { memo, useCallback, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  Focus,
  Grid3X3,
  Magnet,
  Map as MapIcon,
  Maximize,
  PanelBottom,
  Play,
  ScanSearch,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { toggleCanvasInspector, useCanvasInspectorStore } from '../../../design/canvas/canvas-inspector-store'
import {
  zoomCanvasToContent,
  zoomCanvasToEditableSelection
} from '../../../design/canvas/canvas-focus'
import {
  CANVAS_CHROME_DIVIDER,
  CANVAS_CHROME_MENU,
  CANVAS_CHROME_MENU_SEPARATOR,
  CANVAS_CHROME_PILL,
  CanvasChromeMenuItem,
  canvasChromeButtonClass,
  useCanvasChromeCompact,
  useCanvasChromeDismiss
} from './chrome/canvas-chrome-primitives'

const isMac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')
const MOD = isMac ? '⌘' : 'Ctrl+'

type Props = {
  /** Prototype playback only exists on the Design canvas. */
  showPrototypePlay?: boolean
  prototypePlayable?: boolean
  onOpenPrototypePlayer?: () => void
  /** Minimap toggle only where the canvas offers one. */
  minimapAvailable?: boolean
  /** Read-only canvases have no inspector drawer. */
  inspectorAvailable?: boolean
  /** Host buttons (focus, collapse) after a divider. */
  extraActions?: ReactNode
}

function zoomAroundCenter(factor: number): void {
  const s = useCanvasViewportStore.getState()
  s.zoomTo(factor, { x: s.vbox.x + s.vbox.width / 2, y: s.vbox.y + s.vbox.height / 2 })
}

/** Top-right canvas controls: prototype playback, inspector drawer and zoom. */
function CanvasViewControlsInner({
  showPrototypePlay = false,
  prototypePlayable = false,
  onOpenPrototypePlayer,
  minimapAvailable = false,
  inspectorAvailable = true,
  extraActions
}: Props) {
  const { t } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const vbox = useCanvasViewportStore((s) => s.vbox)
  const containerWidth = useCanvasViewportStore((s) => s.containerWidth)
  const gridVisible = useCanvasViewportStore((s) => s.gridVisible)
  const snapEnabled = useCanvasViewportStore((s) => s.snapEnabled)
  const inspectorOpen = useCanvasInspectorStore((s) => s.open)
  const minimapVisible = useCanvasInspectorStore((s) => s.minimapVisible)
  const setMinimapVisible = useCanvasInspectorStore((s) => s.setMinimapVisible)
  const [menuOpen, setMenuOpen] = useState(false)
  const compact = useCanvasChromeCompact()
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  useCanvasChromeDismiss(menuOpen, rootRef, closeMenu)

  const zoomPercent = Math.round((containerWidth / vbox.width) * 100)
  const playDisabled = !prototypePlayable || !onOpenPrototypePlayer
  const playLabel = prototypePlayable ? t('designPrototypePlay') : t('designPrototypePlayUnavailable')
  const inspectorLabel = t(inspectorOpen ? 'canvasInspectorHide' : 'canvasInspectorShow')
  const run = (action: () => void): void => {
    action()
    setMenuOpen(false)
  }

  return (
    <div ref={rootRef} className="relative pointer-events-auto">
      <div className={`design-canvas-zoom-bar ${CANVAS_CHROME_PILL}`} role="toolbar" aria-label={t('canvasViewControls')}>
        {showPrototypePlay ? (
          <button
            type="button"
            className={canvasChromeButtonClass(false, compact)}
            onClick={onOpenPrototypePlayer}
            disabled={playDisabled}
            title={playLabel}
            aria-label={playLabel}
          >
            <Play className="h-4 w-4" strokeWidth={1.9} />
          </button>
        ) : null}
        {inspectorAvailable ? <button
          type="button"
          className={canvasChromeButtonClass(inspectorOpen, compact)}
          onClick={toggleCanvasInspector}
          title={inspectorLabel}
          aria-label={inspectorLabel}
          aria-pressed={inspectorOpen}
          data-canvas-inspector-toggle="true"
        >
          <PanelBottom className="h-4 w-4" strokeWidth={1.9} />
        </button> : null}
        <button
          type="button"
          className={`${canvasChromeButtonClass(menuOpen, compact)} w-auto gap-1 text-[12.5px] font-medium tabular-nums ${compact ? 'min-w-[3.25rem] px-1.5' : 'min-w-[3.75rem] px-2'}`}
          onClick={() => setMenuOpen((open) => !open)}
          title={t('canvasZoomMenu')}
          aria-label={t('canvasZoomMenu')}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <span className="text-ds-ink">{zoomPercent}%</span>
          <ChevronDown className="h-3 w-3 text-ds-faint" strokeWidth={2} />
        </button>
        {extraActions ? (
          <>
            <div className={CANVAS_CHROME_DIVIDER} />
            {extraActions}
          </>
        ) : null}
      </div>
      {menuOpen ? (
        <div role="menu" aria-label={t('canvasZoomMenu')} className={`${CANVAS_CHROME_MENU} right-0 top-full mt-2 w-60`}>
          <CanvasChromeMenuItem
            icon={<ZoomIn className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('canvasZoomIn')}
            shortcut={`${MOD}+`}
            onSelect={() => zoomAroundCenter(1.2)}
          />
          <CanvasChromeMenuItem
            icon={<ZoomOut className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('canvasZoomOut')}
            shortcut={`${MOD}-`}
            onSelect={() => zoomAroundCenter(1 / 1.2)}
          />
          <CanvasChromeMenuItem
            icon={<Maximize className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('canvasZoomTo100')}
            shortcut="⇧0"
            onSelect={() => run(() => useCanvasViewportStore.getState().resetView())}
          />
          <CanvasChromeMenuItem
            icon={<Focus className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('canvasZoomFit')}
            shortcut="⇧1"
            onSelect={() => run(zoomCanvasToContent)}
          />
          <CanvasChromeMenuItem
            icon={<ScanSearch className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('canvasZoomToSelection')}
            shortcut="⇧2"
            onSelect={() => run(zoomCanvasToEditableSelection)}
          />
          <div className={CANVAS_CHROME_MENU_SEPARATOR} />
          <CanvasChromeMenuItem
            role="menuitemcheckbox"
            checked={gridVisible}
            icon={<Grid3X3 className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('canvasGridToggle')}
            onSelect={() => useCanvasViewportStore.getState().toggleGrid()}
          />
          <CanvasChromeMenuItem
            role="menuitemcheckbox"
            checked={snapEnabled}
            icon={<Magnet className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('canvasSnap')}
            onSelect={() => useCanvasViewportStore.getState().toggleSnap()}
          />
          {minimapAvailable ? (
            <CanvasChromeMenuItem
              role="menuitemcheckbox"
              checked={minimapVisible}
              icon={<MapIcon className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label={t('canvasMinimapToggle')}
              onSelect={() => setMinimapVisible(!minimapVisible)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export const CanvasViewControls = memo(CanvasViewControlsInner)
