import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { SidebarTitlebarToggleButton } from '../../../sidebar/SidebarPrimitives'
import { CanvasMinimap } from '../CanvasMinimap'
import { PptImageSlotToggle } from '../PptImageSlotToggle'
import { useCanvasInspectorStore } from '../../../../design/canvas/canvas-inspector-store'
import { useCanvasViewportStore } from '../../../../design/canvas/canvas-viewport-store'

/** Below this host width the view controls drop under the toolbar instead of sharing its row. */
const STACKED_CHROME_WIDTH = 470

/** Host-provided pieces of the floating chrome (the Code whiteboard panel supplies these). */
export type CanvasViewportChromeSlots = {
  /** Drawing title shown on the toolbar's menu button. */
  title?: string
  /** Replaces the toolbar on a read-only canvas (preview badge, continue actions). */
  notice?: ReactNode
  /** Host buttons appended to the top-right view controls (focus, collapse). */
  actions?: ReactNode
}

/**
 * Floating canvas chrome: the tool bar and sidebar toggle share the top-left
 * row, view controls sit top-right, and the optional minimap stays above the
 * inspector drawer at the bottom-left.
 */
export function CanvasViewportChrome({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  sidebarExpandLabel,
  sidebarCollapseLabel,
  minimapEnabled,
  uiScale,
  bottomInset,
  toolbar,
  viewControls,
  children
}: {
  leftSidebarCollapsed?: boolean
  onToggleLeftSidebar?: () => void
  sidebarExpandLabel: string
  sidebarCollapseLabel: string
  minimapEnabled: boolean
  uiScale: number
  /** Space taken at the bottom by the inspector drawer or motion dock. */
  bottomInset: number
  toolbar?: ReactNode
  viewControls?: ReactNode
  children?: ReactNode
}): ReactElement {
  const minimapVisible = useCanvasInspectorStore((s) => s.minimapVisible)
  const stacked = useCanvasViewportStore((s) => s.containerWidth < STACKED_CHROME_WIDTH)
  // Each side is positioned on its own: the scale transform shrinks the pills
  // visually but not their layout box, so a shared flex row would wrap early.
  const topLeftStyle: CSSProperties = { transform: `scale(${uiScale})`, transformOrigin: 'top left' }
  const topRightStyle: CSSProperties = { transform: `scale(${uiScale})`, transformOrigin: 'top right' }
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-40 flex min-w-0 items-start">
        <div
          className={`pointer-events-auto flex min-w-0 items-center gap-2 ${
            leftSidebarCollapsed ? 'ds-window-controls-safe-inset' : ''
          }`}
          style={topLeftStyle}
        >
          {onToggleLeftSidebar ? (
            <SidebarTitlebarToggleButton
              onClick={onToggleLeftSidebar}
              title={leftSidebarCollapsed ? sidebarExpandLabel : sidebarCollapseLabel}
              ariaLabel={leftSidebarCollapsed ? sidebarExpandLabel : sidebarCollapseLabel}
            />
          ) : null}
          {toolbar}
        </div>
      </div>
      <div
        className={`pointer-events-none absolute right-3 z-40 flex flex-col items-end ${stacked ? 'top-[56px]' : 'top-3'}`}
      >
        <div className="pointer-events-auto flex flex-col items-end gap-2" style={topRightStyle}>
          {viewControls}
          <PptImageSlotToggle />
        </div>
      </div>
      {children}
      {minimapEnabled && minimapVisible ? (
        <div
          className="pointer-events-none absolute left-4 z-40 hidden md:block"
          style={{
            bottom: bottomInset + 16,
            transform: `scale(${uiScale})`,
            transformOrigin: 'bottom left'
          }}
        >
          <div className="pointer-events-auto"><CanvasMinimap /></div>
        </div>
      ) : null}
    </>
  )
}
