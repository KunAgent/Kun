import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { BrowserUseMountInput, BrowserUseViewState } from '@shared/browser-use'

function emptyState(): BrowserUseViewState {
  return {
    contractVersion: 1,
    capabilityStatus: 'available',
    lifecycle: 'closed',
    controlOwner: 'agent',
    visible: false,
    mounted: false,
    mode: 'public',
    tabs: [],
    updatedAt: new Date(0).toISOString()
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The owner is keyed by thread, expected turn, and active state. Every callback
// also checks its effect lifetime, including callbacks retained after unmount.
export function useAgentBrowserPanelLifecycle(
  threadId: string | null,
  expectedTurnId: string | undefined,
  hostRef: RefObject<HTMLDivElement | null>
) {
  const [state, setState] = useState<BrowserUseViewState>(emptyState)
  const [operationError, setOperationError] = useState<string>()
  const [pendingOperation, setPendingOperation] = useState<'action' | 'stop'>()
  const live = useRef(false)
  const eventRevision = useRef(0)
  const operationSequence = useRef(0)
  const operation = useRef<'action' | 'stop' | undefined>(undefined)
  const stateRef = useRef(state)
  const mountSync = useRef<(() => void) | undefined>(undefined)
  const visible = useRef(false)
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0]
  const shouldShowPage = Boolean(activeTab && !state.pendingOriginConsent && !state.pendingActionConsent)

  const accept = useCallback((next: BrowserUseViewState): void => {
    if (!live.current || !threadId) return
    // Main's empty state intentionally has no thread/session. A populated
    // snapshot must always identify its owner, including for direct IPC replies.
    if (next.threadId !== threadId && (next.threadId || next.sessionId)) return
    const scoped = expectedTurnId && next.sessionId && next.turnId !== expectedTurnId
      ? emptyState()
      : next
    stateRef.current = scoped
    setState(scoped)
  }, [threadId, expectedTurnId])

  useLayoutEffect(() => {
    if (!threadId) return
    live.current = true
    let disposed = false
    const api = window.kunGui
    // Subscribe before reading so an event cannot fall into the initial-read gap.
    const unsubscribe = api.onBrowserUseState((next) => {
      if (disposed || !live.current || next.threadId !== threadId) return
      eventRevision.current += 1
      accept(next)
    })
    const revision = eventRevision.current
    const request = expectedTurnId
      ? api.getBrowserUseState(threadId, expectedTurnId)
      : api.getBrowserUseState(threadId)
    void request.then((next) => {
      if (!disposed && live.current && eventRevision.current === revision) accept(next)
    }).catch((error) => {
      if (!disposed && live.current && eventRevision.current === revision) setOperationError(message(error))
    })
    return () => {
      disposed = true
      live.current = false
      eventRevision.current += 1
      operationSequence.current += 1
      operation.current = undefined
      unsubscribe()
    }
  }, [threadId, expectedTurnId, accept])

  useLayoutEffect(() => {
    visible.current = shouldShowPage
    mountSync.current?.()
  }, [shouldShowPage])

  useLayoutEffect(() => {
    const element = hostRef.current
    if (!threadId || !state.sessionId || !element) return
    const api = window.kunGui
    let disposed = false
    let sequence = 0
    let lastInput: BrowserUseMountInput | undefined
    const sync = (): void => {
      if (disposed || !live.current) return
      const rect = element.getBoundingClientRect()
      const input: BrowserUseMountInput = {
        threadId,
        ...(expectedTurnId ? { expectedTurnId } : {}),
        visible: visible.current,
        supervisionActive: true,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }
      if (lastInput && JSON.stringify(lastInput) === JSON.stringify(input)) return
      lastInput = input
      const request = ++sequence
      const revision = eventRevision.current
      // Mount publishes the authoritative state event. Its reply can predate
      // newer events/actions, so it must never replace the rendered snapshot.
      void api.mountBrowserUse(input).catch((error) => {
        if (!disposed && live.current && sequence === request && eventRevision.current === revision) {
          setOperationError(message(error))
        }
      })
    }
    mountSync.current = sync
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    window.addEventListener('resize', sync)
    return () => {
      disposed = true
      if (mountSync.current === sync) mountSync.current = undefined
      observer.disconnect()
      window.removeEventListener('resize', sync)
      // Capture this lease's thread/turn/bounds, not the next render's host ref.
      // Hiding for consent is not lease disposal and keeps supervision active.
      if (lastInput) {
        void api.mountBrowserUse({ ...lastInput, visible: false, supervisionActive: false })
          .catch(() => undefined)
      }
    }
  }, [threadId, expectedTurnId, state.sessionId, hostRef])

  const run = useCallback(async (
    action: () => Promise<BrowserUseViewState>,
    interrupt = false
  ): Promise<void> => {
    if (!live.current || !threadId || !stateRef.current.sessionId) return
    if (operation.current && (!interrupt || operation.current === 'stop')) return
    const request = ++operationSequence.current
    const revision = eventRevision.current
    operation.current = interrupt ? 'stop' : 'action'
    setPendingOperation(operation.current)
    setOperationError(undefined)
    try {
      const next = await action()
      if (live.current && operationSequence.current === request && eventRevision.current === revision) accept(next)
    } catch (error) {
      if (live.current && operationSequence.current === request && eventRevision.current === revision) {
        setOperationError(message(error))
      }
    } finally {
      if (live.current && operationSequence.current === request) {
        operation.current = undefined
        setPendingOperation(undefined)
      }
    }
  }, [threadId, accept])

  return { state, operationError, pendingOperation, run }
}
