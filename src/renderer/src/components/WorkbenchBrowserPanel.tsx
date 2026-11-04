import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { PictureInPicture2 } from 'lucide-react'
import { AgentBrowserSurfaceSlot } from './AgentBrowserSurfaceSlot'
import { DevBrowserPanel, type DevBrowserPanelProps } from './DevBrowserPanel'
import { isBrowserUseSessionActive, useAgentBrowserPreviewStore } from './agent-browser-preview-state'
import { useAgentBrowserPreview } from './use-agent-browser-preview'

export function WorkbenchBrowserPanel({ active = true, ...props }: DevBrowserPanelProps & { active?: boolean }) {
  const { t } = useTranslation('common')
  const threadId = props.activeThreadId ?? null
  const { state: observed, presentation } = useAgentBrowserPreview(active ? threadId : null)
  const state = observed.sessionId ? observed : presentation?.snapshot ?? observed
  const docked = active && isBrowserUseSessionActive(state, threadId) && presentation?.surface === 'panel'
  const tab = state.tabs.find((item) => item.id === state.activeTabId) ?? state.tabs[0]
  const title = tab?.title || t('browserUseFloatingTitle')
  const onTitleChange = props.onTitleChange

  useEffect(() => {
    if (docked) onTitleChange?.(title)
  }, [docked, title, onTitleChange])

  useEffect(() => {
    if (!docked) return
    const owner = { threadId: state.threadId, sessionId: state.sessionId, turnId: state.turnId }
    return () => {
      const store = useAgentBrowserPreviewStore.getState()
      if (owner.threadId && store.byThreadId[owner.threadId]?.surface === 'panel') {
        store.setSurface(owner, 'floating', false)
      }
    }
  }, [docked, state.threadId, state.sessionId, state.turnId])

  if (!docked) return <DevBrowserPanel {...props} />
  return <section className={`flex h-full min-h-0 flex-col ${props.className ?? ''}`} aria-label={t('browserUseFloatingTitle')}>
    <header className="flex min-h-10 shrink-0 items-center gap-2 border-b border-ds-border px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-ds-ink">{title}</span>
      <button type="button" aria-label={t('browserUseFloatPreview')} title={t('browserUseFloatPreview')}
        className="grid size-7 shrink-0 place-items-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
        onClick={() => {
          useAgentBrowserPreviewStore.getState().setSurface(state, 'floating')
          props.onCollapse()
        }}><PictureInPicture2 size={15} /></button>
    </header>
    <div className="min-h-0 flex-1"><AgentBrowserSurfaceSlot state={state} variant="full" /></div>
  </section>
}
