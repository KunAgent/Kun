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
    if (request.status === 'pending') {
      seenPending.add(block.id)
      continue
    }
    if (request.status !== 'ready' || !request.requestId || handled.has(request.requestId)) continue
    handled.add(request.requestId)
    const turnLive = live.busy && Boolean(block.turnId) && block.turnId === live.currentTurnId
    if (seenPending.has(block.id) || turnLive) ready.push({ blockId: block.id, request })
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
  const currentTurnId = useChatStore((state) => state.currentTurnId)
  const seenPendingRef = useRef(new Set<string>())
  const handledRef = useRef(new Set<string>())
  const latestRef = useRef(options)
  latestRef.current = options

  useEffect(() => {
    if (!activeThreadId) return
    const ready = takeLiveDesignRequests(
      blocks,
      { busy, currentTurnId },
      seenPendingRef.current,
      handledRef.current
    )
    if (ready.length === 0) return
    const thread = latestRef.current.threads.find((candidate) => candidate.id === activeThreadId)
    const workspaceRoot = normalizeWorkspaceRoot(thread?.workspace || latestRef.current.workspaceRoot)
    if (!workspaceRoot) return
    void (async () => {
      // Register every arrived design in order, then show the newest one.
      for (const item of ready.slice(0, -1)) await ingestAgentDesign({ workspaceRoot, request: item.request })
      await openAgentDesignCanvas({ threadId: activeThreadId, workspaceRoot, request: ready[ready.length - 1].request })
    })()
  }, [activeThreadId, blocks, busy, currentTurnId])
}
