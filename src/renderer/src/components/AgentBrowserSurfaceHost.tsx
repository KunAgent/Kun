import { createPortal } from 'react-dom'
import type { BrowserUseViewState } from '@shared/browser-use'
import { AgentBrowserPanel } from './AgentBrowserPanel'
import { isBrowserUseSessionActive } from './agent-browser-preview-state'
import { useAgentBrowserSurfaceStore } from './agent-browser-surface-store'

export function AgentBrowserSurfaceHost({ state, activeThreadId }: {
  state: BrowserUseViewState
  activeThreadId: string | null
}) {
  const surface = useAgentBrowserSurfaceStore((store) => activeThreadId ? store.byThreadId[activeThreadId] : undefined)
  if (!isBrowserUseSessionActive(state, activeThreadId) || !surface || surface.sessionId !== state.sessionId ||
    surface.turnId !== state.turnId || surface.rect.width <= 0 || surface.rect.height <= 0) return null
  const { rect, variant } = surface
  const host = <div className="ds-no-drag fixed z-[80]" data-agent-browser-surface-host
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
    <AgentBrowserPanel threadId={activeThreadId} expectedTurnId={state.turnId} active variant={variant}
      layoutVersion={`${rect.x}:${rect.y}:${rect.width}:${rect.height}:${variant}`} />
  </div>
  return typeof document === 'undefined' ? host : createPortal(host, document.body)
}
