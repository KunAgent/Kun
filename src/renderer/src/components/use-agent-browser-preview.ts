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
  const [operationError, setOperationError] = useState<string>()
  const [pendingOperation, setPendingOperation] = useState<'action' | 'stop'>()
  const sequence = useRef(0)
  const pending = useRef<'action' | 'stop' | undefined>(undefined)
  const owner = useRef(state)
  const lifetime = useRef(0)
  const revision = useRef(0)
  const presentation = useAgentBrowserPreviewStore((store) => threadId ? store.byThreadId[threadId] : undefined)
  const accept = useCallback((next: BrowserUseViewState) => {
    if (!threadId || (next.threadId !== threadId && (next.threadId || next.sessionId))) return
    useAgentBrowserPreviewStore.getState().observe(next, threadId)
    if (owner.current.sessionId !== next.sessionId || owner.current.turnId !== next.turnId) {
      sequence.current++
      pending.current = undefined
      setPendingOperation(undefined)
      setOperationError(undefined)
    }
    owner.current = next
    setState(next)
  }, [threadId])

  useEffect(() => {
    const generation = ++lifetime.current
    setState(emptyState())
    owner.current = emptyState()
    sequence.current++
    pending.current = undefined
    setPendingOperation(undefined)
    setOperationError(undefined)
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
  const run = async (operation: () => Promise<BrowserUseViewState>, interrupt = false): Promise<void> => {
    const current = () => lifetime.current === operationGeneration && owner.current.sessionId === state.sessionId &&
      owner.current.turnId === state.turnId && owner.current.threadId === state.threadId
    if (!current() || !state.sessionId || (pending.current && (!interrupt || pending.current === 'stop'))) return
    const request = ++sequence.current
    const beforeRequest = revision.current
    pending.current = interrupt ? 'stop' : 'action'
    setPendingOperation(pending.current)
    setOperationError(undefined)
    try {
      const next = await operation()
      if (current() && sequence.current === request && revision.current === beforeRequest) accept(next)
    } catch (error) {
      if (current() && sequence.current === request) setOperationError(error instanceof Error ? error.message : String(error))
    } finally {
      if (current() && sequence.current === request) {
        pending.current = undefined
        setPendingOperation(undefined)
      }
    }
  }
  return {
    state, run, presentation, operationError, pendingOperation,
    dismissError: () => setOperationError(undefined), previewOpen: isBrowserPreviewOpen(presentation, state),
    setPreviewOpen: (open: boolean) => useAgentBrowserPreviewStore.getState().setOpen(state, open)
  }
}
