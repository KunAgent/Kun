import { lazy, Suspense, type ReactElement } from 'react'

const TerminalPanel = lazy(() =>
  import('./TerminalPanel').then((module) => ({ default: module.TerminalPanel }))
)

/**
 * Bottom terminal drawer shared by the Code chat stage and the ADE Mission
 * Control surface (P4-09): install/login setup actions need a terminal on
 * the agent home too, not only inside a conversation. The panel drains any
 * pending terminal-open request itself (terminal-open.ts).
 */
export function TerminalDrawer({
  workspaceRoot,
  height,
  onBeginResize,
  onCollapse
}: {
  workspaceRoot: string
  height: number
  onBeginResize: React.PointerEventHandler<HTMLDivElement>
  onCollapse: () => void
}): ReactElement {
  return (
    <div className="ds-no-drag relative z-[3] flex w-full shrink-0 flex-col px-0 pb-0">
      <div
        role="separator"
        aria-orientation="horizontal"
        className="relative z-20 h-1 shrink-0 cursor-row-resize bg-transparent transition hover:bg-ds-border-muted"
        onPointerDown={onBeginResize}
      />
      <Suspense fallback={<div className="ds-surface-strong h-full w-full" />}>
        <TerminalPanel
          workspaceRoot={workspaceRoot}
          height={height}
          className="w-full"
          onCollapse={onCollapse}
        />
      </Suspense>
    </div>
  )
}
