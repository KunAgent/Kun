import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserUseViewState } from '@shared/browser-use'
import { isBrowserPreviewOpen, useAgentBrowserPreviewStore } from './agent-browser-preview-state'

function emptyState(): BrowserUseViewState {
  return {
    contractVersion: 1, capabilityStatus: 'disabled', lifecycle: 'closed', controlOwner: 'agent',
    visible: false, mounted: false, mode: 'public', tabs: [], updatedAt: new Date(0).toISOString()
  }
}

export function useAgentBrowserPreview(threadId: string | null) {
  const [state, setState] = useState<BrowserUseViewState>(emptyState)
  const lifetime = useRef(0)
  const revision = useRef(0)
  const presentation = useAgentBrowserPreviewStore((store) => threadId ? store.byThreadId[threadId] : undefined)
  const accept = useCallback((next: BrowserUseViewState) => {
    if (!threadId || (next.threadId !== threadId && (next.threadId || next.sessionId))) return
    useAgentBrowserPreviewStore.getState().observe(next, threadId)
    setState(next)
  }, [threadId])

  useEffect(() => {
    const generation = ++lifetime.current
    setState(emptyState())
    if (!threadId) return
    const api = window.kunGui
    const unsubscribe = api.onBrowserUseState((next) => {
      if (lifetime.current !== generation || next.threadId !== threadId) return
      revision.current++
      accept(next)
    })
    const beforeRead = revision.current
    void api.getBrowserUseState(threadId).then((next) => {
      if (lifetime.current === generation && revision.current === beforeRead) accept(next)
    }).catch(() => undefined)
    return () => {
      lifetime.current = generation + 1
      unsubscribe()
    }
  }, [threadId, accept])

  const operationGeneration = lifetime.current
  const run = async (operation: () => Promise<BrowserUseViewState>): Promise<void> => {
    if (lifetime.current !== operationGeneration) return
    const beforeRequest = revision.current
    try {
      const next = await operation()
      if (lifetime.current === operationGeneration && revision.current === beforeRequest) accept(next)
    } catch {
      // Main publishes bounded operation errors through the owning session's state.
    }
  }
  return {
    state, run, presentation, previewOpen: isBrowserPreviewOpen(presentation, state),
    setPreviewOpen: (open: boolean) => useAgentBrowserPreviewStore.getState().setOpen(state, open)
  }
}
