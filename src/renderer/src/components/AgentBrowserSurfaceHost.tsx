import { createPortal } from 'react-dom'
import type { BrowserUseViewState } from '@shared/browser-use'
import { AgentBrowserPanel } from './AgentBrowserPanel'
import { isBrowserUseSessionActive } from './agent-browser-preview-state'
import { useAgentBrowserSurfaceStore } from './agent-browser-surface-store'
import { toLayoutPx } from '../lib/body-zoom'

export function AgentBrowserSurfaceHost({ state, activeThreadId, occluded = false }: {
  state: BrowserUseViewState
  activeThreadId: string | null
  occluded?: boolean
}) {
  const surface = useAgentBrowserSurfaceStore((store) => activeThreadId ? store.byThreadId[activeThreadId] : undefined)
  if (!isBrowserUseSessionActive(state, activeThreadId) || !surface || surface.sessionId !== state.sessionId ||
    surface.turnId !== state.turnId || surface.rect.width <= 0 || surface.rect.height <= 0) return null
  const { rect, variant, layoutScale = 1 } = surface
  const visible = surface.visible !== false && !occluded
  // Slots report visual pixels. The body portal's CSS positions are layout
  // pixels; native IPC will measure this host back into visual pixels once.
  // Keep consent DOM above the shell even when expansion portals it to body later.
  const host = <div className="ds-no-drag fixed z-[81] overflow-hidden" data-agent-browser-surface-host
    aria-hidden={!visible}
    style={{ left: toLayoutPx(rect.x, layoutScale), top: toLayoutPx(rect.y, layoutScale),
      width: toLayoutPx(rect.width, layoutScale), height: toLayoutPx(rect.height, layoutScale),
      visibility: visible ? 'visible' : 'hidden', pointerEvents: visible ? 'auto' : 'none' }}>
    <AgentBrowserPanel threadId={activeThreadId} expectedTurnId={state.turnId} active variant={variant}
      displayVisible={visible}
      layoutVersion={`${rect.x}:${rect.y}:${rect.width}:${rect.height}:${variant}:${layoutScale}`} />
  </div>
  return typeof document === 'undefined' ? host : createPortal(host, document.body)
}
