import { useEffect, useRef } from 'react'
import type { ChatBlock, NormalizedThread } from '../../agent/types'
import { readDesignOpenRequest, type DesignOpenRequestMetadata } from '../../agent/design-open-request'
import { useChatStore } from '../../store/chat-store'
import { ingestAgentDesign, openAgentDesignCanvas } from '../../design/agent-design-ingest'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'

type LiveDesignRequest = { blockId: string; request: DesignOpenRequestMetadata }

/**
 * `design_open` results that should open their canvas now: ones that arrived
 * in this window (the call was seen streaming, or its turn is still running).
 * Results replayed from history are only marked handled; the card reopens them.
 */
export function takeLiveDesignRequests(
  blocks: readonly ChatBlock[],
  live: { busy: boolean; currentTurnId: string | null },
  seenPending: Set<string>,
  handled: Set<string>
): LiveDesignRequest[] {
  const ready: LiveDesignRequest[] = []
  for (const block of blocks) {
    const request = readDesignOpenRequest(block)
    if (!request) continue
    const turnLive = live.busy && Boolean(block.turnId) && block.turnId === live.currentTurnId
    if (request.status === 'pending') {
      if (turnLive && block.kind === 'tool' && block.status === 'running') seenPending.add(block.id)
      continue
    }
    if (request.status !== 'ready' || !request.requestId || handled.has(request.requestId)) continue
    handled.add(request.requestId)
    if (seenPending.delete(block.id) || turnLive) ready.push({ blockId: block.id, request })
  }
  return ready
}

export function useAgentDesignAutoOpen(options: {
  activeThreadId: string | null
  threads: readonly NormalizedThread[]
  workspaceRoot: string
}): void {
  const { activeThreadId } = options
  const blocks = useChatStore((state) => state.blocks)
  const busy = useChatStore((state) => state.busy)
  const busyUnconfirmed = useChatStore((state) => state.busyUnconfirmed)
  const threadLoadingId = useChatStore((state) => state.threadLoadingId)
  const currentTurnId = useChatStore((state) => state.currentTurnId)
  const trackingRef = useRef({ threadId: activeThreadId, initialized: false, seenPending: new Set<string>(), handled: new Set<string>() })
  if (trackingRef.current.threadId !== activeThreadId) {
    trackingRef.current = { threadId: activeThreadId, initialized: false, seenPending: new Set(), handled: new Set() }
  }
  const latestRef = useRef(options)
  latestRef.current = options
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!activeThreadId || useChatStore.getState().activeThreadId !== activeThreadId) return
    const tracking = trackingRef.current
    if (threadLoadingId === activeThreadId) {
      tracking.initialized = false
      return
    }
    // The first projection after selection/hydration is history, even if a
    // cached turn still says running. Only subsequent arrivals can reveal UI.
    const live = tracking.initialized && busy && !busyUnconfirmed
    tracking.initialized = true
    const ready = takeLiveDesignRequests(
      blocks,
      { busy: live, currentTurnId },
      tracking.seenPending,
      tracking.handled
    )
    if (ready.length === 0) return
    const thread = latestRef.current.threads.find((candidate) => candidate.id === activeThreadId)
    const workspaceRoot = normalizeWorkspaceRoot(thread?.workspace || latestRef.current.workspaceRoot)
    if (!workspaceRoot) return
    const isCurrent = (): boolean => {
      const latest = latestRef.current
      const latestThread = latest.threads.find((candidate) => candidate.id === activeThreadId)
      return mountedRef.current && trackingRef.current === tracking &&
        latest.activeThreadId === activeThreadId && useChatStore.getState().activeThreadId === activeThreadId &&
        normalizeWorkspaceRoot(latestThread?.workspace || latest.workspaceRoot) === workspaceRoot
    }
    void (async () => {
      // Register every arrived design in order, then show the newest one.
      for (const item of ready.slice(0, -1)) {
        if (!isCurrent()) return
        await ingestAgentDesign({ workspaceRoot, request: item.request, isCurrent })
      }
      if (!isCurrent()) return
      await openAgentDesignCanvas({ threadId: activeThreadId, workspaceRoot, request: ready[ready.length - 1].request, isCurrent })
    })().catch((error) => { console.warn('Unable to reveal the agent design canvas', error) })
  }, [activeThreadId, blocks, busy, busyUnconfirmed, currentTurnId, threadLoadingId])
}
