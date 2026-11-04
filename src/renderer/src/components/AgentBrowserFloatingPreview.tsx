import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe2, Loader2, ShieldAlert } from 'lucide-react'
import { AgentBrowserSurfaceHost } from './AgentBrowserSurfaceHost'
import { AgentBrowserSurfaceSlot } from './AgentBrowserSurfaceSlot'
import { AgentBrowserPreviewShell } from './AgentBrowserPreviewShell'
import { browserUsePreviewNeedsAttention, isBrowserUseSessionActive, useAgentBrowserPreviewStore } from './agent-browser-preview-state'
import { useAgentBrowserPreview } from './use-agent-browser-preview'

export { isBrowserUseSessionActive, shouldAutoOpenBrowserUsePreview } from './agent-browser-preview-state'

export function AgentBrowserFloatingPreview({ activeThreadId, onOpenInPanel }: {
  activeThreadId: string | null
  onOpenInPanel?: () => void
}): ReactElement | null {
  const controller = useAgentBrowserPreview(activeThreadId)
  return <>
    <AgentBrowserSurfaceHost state={controller.state} activeThreadId={activeThreadId} />
    <FloatingBrowserPresentation activeThreadId={activeThreadId} onOpenInPanel={onOpenInPanel} controller={controller} />
  </>
}

function FloatingBrowserPresentation({ activeThreadId, onOpenInPanel, controller }: {
  activeThreadId: string | null
  onOpenInPanel?: () => void
  controller: ReturnType<typeof useAgentBrowserPreview>
}) {
  const { t } = useTranslation('common')
  const { state, presentation, previewOpen, setPreviewOpen, run } = controller
  if (!isBrowserUseSessionActive(state, activeThreadId) || !activeThreadId || presentation?.surface === 'panel') return null
  const threadId = activeThreadId
  const turnScope = state.turnId ? { expectedTurnId: state.turnId } : {}
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0]
  const needsAttention = browserUsePreviewNeedsAttention(state, threadId)
  const loading = state.lifecycle === 'loading' || activeTab?.loading
  if (!previewOpen) return <button type="button" onClick={() => setPreviewOpen(true)}
    aria-label={t('browserUseShowPreview')}
    className={`ds-no-drag absolute bottom-3 right-3 z-[80] flex max-w-[min(360px,calc(100%_-_24px))] items-center gap-2 rounded-full border bg-ds-card/95 px-3 py-2 text-left shadow-lg backdrop-blur-xl hover:border-accent/45 ${needsAttention ? 'border-amber-400/70' : 'border-ds-border'}`}>
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ds-surface-subtle text-ds-muted">
      {loading ? <Loader2 size={14} className="animate-spin" /> : needsAttention ? <ShieldAlert size={14} /> : <Globe2 size={14} />}
    </span>
    <span className="min-w-0">
      <span className="block truncate text-[11px] font-semibold text-ds-ink">{t(needsAttention ? 'browserUseNeedsAttention' : 'browserUseBackgroundRunning')}</span>
      <span className="block truncate text-[10px] text-ds-faint">{activeTab?.title || activeTab?.origin || t('browserUseTemporaryAnonymous')}</span>
    </span>
  </button>
  return <AgentBrowserPreviewShell state={state}
    onClose={() => setPreviewOpen(false)}
    onDock={onOpenInPanel ? () => {
      useAgentBrowserPreviewStore.getState().setSurface(state, 'panel')
      onOpenInPanel()
    } : undefined}
    onToggleControl={() => void run(() => window.kunGui.setBrowserUseControl({
      threadId, ...turnScope, controlOwner: state.controlOwner === 'agent' ? 'manual' : 'agent'
    }))}
    onNavigate={(command) => void run(() => window.kunGui.navigateBrowserUse({ threadId, ...turnScope, command }))}
    onStop={() => void run(() => state.turnId ? window.kunGui.stopBrowserUse(threadId, state.turnId) : window.kunGui.stopBrowserUse(threadId))}
    onClear={() => void run(() => state.turnId ? window.kunGui.clearBrowserUse(threadId, state.turnId) : window.kunGui.clearBrowserUse(threadId))}>
    {(frame) => <AgentBrowserSurfaceSlot state={state} variant="pip"
      layoutVersion={`${frame.x}:${frame.y}:${frame.width}:${frame.height}`} />}
  </AgentBrowserPreviewShell>
}
