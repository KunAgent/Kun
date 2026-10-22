import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { SidebarTitlebarToggleButton } from '../../../sidebar/SidebarPrimitives'
import { CanvasZoomBar } from '../CanvasZoomBar'
import { CanvasMinimap } from '../CanvasMinimap'
import { PptImageSlotToggle } from '../PptImageSlotToggle'

export function CanvasViewportChrome({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  sidebarExpandLabel,
  sidebarCollapseLabel,
  minimapEnabled,
  uiScale,
  children
}: {
  leftSidebarCollapsed?: boolean
  onToggleLeftSidebar?: () => void
  sidebarExpandLabel: string
  sidebarCollapseLabel: string
  minimapEnabled: boolean
  uiScale: number
  children?: ReactNode
}): ReactElement {
  const bottomStyle: CSSProperties = {
    bottom: 'var(--canvas-bottom-ui-inset)',
    transform: `scale(${uiScale})`,
    transformOrigin: 'bottom right'
  }
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-40 flex min-w-0 items-start">
        <div className={`pointer-events-auto flex min-w-0 items-center gap-2 ${
          leftSidebarCollapsed ? 'ds-window-controls-safe-inset' : ''
        }`}>
          {onToggleLeftSidebar ? (
            <SidebarTitlebarToggleButton
              onClick={onToggleLeftSidebar}
              title={leftSidebarCollapsed ? sidebarExpandLabel : sidebarCollapseLabel}
              ariaLabel={leftSidebarCollapsed ? sidebarExpandLabel : sidebarCollapseLabel}
            />
          ) : null}
        </div>
      </div>
      {children}
      <div className="pointer-events-none absolute right-3 top-3 z-40">
        <div className="pointer-events-auto"><PptImageSlotToggle /></div>
      </div>
      <div className="pointer-events-none absolute right-4 z-40 hidden lg:block" style={bottomStyle}>
        <div className="pointer-events-auto"><CanvasZoomBar /></div>
      </div>
      {minimapEnabled ? (
        <div
          className="pointer-events-none absolute left-4 z-40 hidden md:block"
          style={{ ...bottomStyle, transformOrigin: 'bottom left' }}
        >
          <div className="pointer-events-auto"><CanvasMinimap /></div>
        </div>
      ) : null}
    </>
  )
}
