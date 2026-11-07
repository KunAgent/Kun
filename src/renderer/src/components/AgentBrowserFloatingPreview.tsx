import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe2, Hand, Loader2, ShieldAlert, Square } from 'lucide-react'
import { AgentBrowserSurfaceHost } from './AgentBrowserSurfaceHost'
import { AgentBrowserSurfaceSlot } from './AgentBrowserSurfaceSlot'
import { AgentBrowserPreviewShell } from './AgentBrowserPreviewShell'
import { AgentBrowserClearConfirmation } from './AgentBrowserClearConfirmation'
import { browserUsePreviewNeedsAttention, isBrowserUseSessionActive, useAgentBrowserPreviewStore } from './agent-browser-preview-state'
import { browserPreviewStatusKey } from './agent-browser-preview-status'
import { useAgentBrowserPreview } from './use-agent-browser-preview'
import { useAgentBrowserOccluded } from './use-agent-browser-occluded'

export { isBrowserUseSessionActive, shouldAutoOpenBrowserUsePreview } from './agent-browser-preview-state'

export function AgentBrowserFloatingPreview({ activeThreadId, onOpenInPanel }: {
  activeThreadId: string | null
  onOpenInPanel?: () => void
}): ReactElement | null {
  const controller = useAgentBrowserPreview(activeThreadId)
  const occluded = useAgentBrowserOccluded()
  return <>
    <AgentBrowserSurfaceHost state={controller.state} activeThreadId={activeThreadId} occluded={occluded} />
    <FloatingBrowserPresentation key={JSON.stringify([activeThreadId, controller.state.sessionId, controller.state.turnId])}
      activeThreadId={activeThreadId} onOpenInPanel={onOpenInPanel} controller={controller} occluded={occluded} />
  </>
}

function FloatingBrowserPresentation({ activeThreadId, onOpenInPanel, controller, occluded }: {
  activeThreadId: string | null
  onOpenInPanel?: () => void
  controller: ReturnType<typeof useAgentBrowserPreview>
  occluded: boolean
}) {
  const { t } = useTranslation('common')
  const [confirmClear, setConfirmClear] = useState(false)
  const { state, presentation, previewOpen, setPreviewOpen, run, operationError, pendingOperation, dismissError } = controller
  useEffect(() => {
    if (state.pendingOriginConsent || state.pendingActionConsent) setConfirmClear(false)
  }, [state.pendingOriginConsent, state.pendingActionConsent])
  if (!isBrowserUseSessionActive(state, activeThreadId) || !activeThreadId || presentation?.surface === 'panel') return null
  const threadId = activeThreadId
  const turnScope = state.turnId ? { expectedTurnId: state.turnId } : {}
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0]
  const consent = Boolean(state.pendingOriginConsent || state.pendingActionConsent)
  const needsAttention = browserUsePreviewNeedsAttention(state, threadId)
  const failed = Boolean(operationError || state.lifecycle === 'error' || state.capabilityStatus === 'unavailable' || state.capabilityStatus === 'disabled')
  const loading = !failed && (state.lifecycle === 'loading' || activeTab?.loading)
  const stop = () => {
    setConfirmClear(false)
    void run(() => state.turnId ? window.kunGui.stopBrowserUse(threadId, state.turnId) : window.kunGui.stopBrowserUse(threadId), true)
  }
  const navigate = (command: 'back' | 'forward' | 'reload') => void run(() => window.kunGui.navigateBrowserUse({ threadId, ...turnScope, command }))
  const dock = onOpenInPanel ? () => {
    useAgentBrowserPreviewStore.getState().setSurface(state, 'panel')
    onOpenInPanel()
  } : undefined
  const overlay = consent ? undefined : confirmClear ? <AgentBrowserClearConfirmation
    onCancel={() => setConfirmClear(false)} onConfirm={() => {
      setConfirmClear(false)
      void run(() => state.turnId ? window.kunGui.clearBrowserUse(threadId, state.turnId) : window.kunGui.clearBrowserUse(threadId))
    }} /> : operationError ? <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto bg-ds-card p-5 text-center">
      <ShieldAlert size={28} className="text-red-600 dark:text-red-300" />
      <h3 className="text-sm font-semibold text-ds-ink">{t('browserUsePreviewError')}</h3>
      <p className="max-w-sm break-words text-xs leading-5 text-ds-muted">{operationError}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {activeTab && state.lifecycle !== 'stopped' ? <button type="button" onClick={() => navigate('reload')}
          className="min-h-8 rounded-md border border-ds-border px-3 text-xs text-ds-ink">{t('browserReload')}</button> : null}
        {dock ? <button type="button" onClick={dock}
          className="min-h-8 rounded-md border border-ds-border px-3 text-xs text-ds-ink">{t('browserUseDockPreview')}</button> : null}
        <button type="button" onClick={dismissError}
          className="min-h-8 rounded-md border border-ds-border px-3 text-xs text-ds-ink">{t('browserUseDismissError')}</button>
      </div>
    </div> : undefined
  return <>
    <AgentBrowserPreviewShell state={state} collapsed={!previewOpen} occluded={occluded} overlay={overlay}
      operationError={operationError} pendingOperation={pendingOperation}
      onClose={() => { if (!consent) { setConfirmClear(false); setPreviewOpen(false) } }}
      onDock={dock}
      onToggleControl={() => void run(() => window.kunGui.setBrowserUseControl({
        threadId, ...turnScope, controlOwner: state.controlOwner === 'agent' ? 'manual' : 'agent'
      }))}
      onNavigate={navigate}
      onZoom={(zoomPercent) => void run(() => window.kunGui.setBrowserUseZoom({ threadId, ...turnScope, zoomPercent }))}
      onStop={stop} onClear={() => { if (!consent) setConfirmClear(true) }}>
      {(frame, visible) => <AgentBrowserSurfaceSlot state={state} variant="pip" visible={visible}
        layoutVersion={`${frame.x}:${frame.y}:${frame.width}:${frame.height}`} />}
    </AgentBrowserPreviewShell>
    {!previewOpen && !occluded ? <div className="ds-no-drag absolute right-3 top-3 z-[80] flex max-w-[min(380px,calc(100%_-_24px))] items-center gap-1 rounded-xl border border-ds-border-strong bg-ds-card p-1.5 shadow-lg">
      <button type="button" onClick={() => setPreviewOpen(true)} aria-label={t('browserUseShowPreview')} autoFocus
        className="flex min-h-9 min-w-0 items-center gap-2 rounded-lg px-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ds-surface-subtle text-ds-muted">
          {failed || needsAttention ? <ShieldAlert size={16} /> : state.controlOwner === 'manual' ? <Hand size={16} />
            : loading ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> : <Globe2 size={16} />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-semibold text-ds-ink">{t(browserPreviewStatusKey(state, operationError))}</span>
          <span className="block truncate text-[10px] text-ds-muted">{activeTab?.title || activeTab?.origin || t('browserUseTemporaryAnonymous')}</span>
        </span>
      </button>
      <button type="button" onClick={stop} aria-label={t('browserUseStop')} title={t('browserUseStop')}
        disabled={pendingOperation === 'stop' || state.lifecycle === 'stopped'}
        className="grid size-8 shrink-0 place-items-center rounded-md text-ds-muted hover:bg-ds-hover disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        <Square size={14} />
      </button>
    </div> : null}
  </>
}
