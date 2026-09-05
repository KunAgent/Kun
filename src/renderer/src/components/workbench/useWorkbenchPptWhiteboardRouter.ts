import { useEffect, useRef } from 'react'
import type { ChatBlock, NormalizedThread } from '../../agent/types'
import { requestCodeCanvasPanelOpen } from '../../lib/code-canvas-panel-event'
import type { AppRoute } from '../../store/chat-store-types'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import {
  pptCanvasOpenRequestForBlock,
  routePptCanvasOpenRequest
} from './workbench-ppt-whiteboard-routing'
import { workspaceRootScopeKey } from '../../lib/workspace-path'

export function useWorkbenchPptWhiteboardRouter(input: {
  activeThreadId: string | null
  blocks: ChatBlock[]
  route: AppRoute
  threads: NormalizedThread[]
  workspaceRoot: string
}): void {
  const handledBlockIdsRef = useRef(new Set<string>())
  const requestGenerationRef = useRef(0)
  useEffect(() => {
    if (input.route !== 'chat' && input.route !== 'write') return
    const requestGeneration = ++requestGenerationRef.current
    let cancelled = false
    const requestIsCurrent = (workspaceRoot: string): boolean => {
      if (cancelled || requestGenerationRef.current !== requestGeneration) return false
      return workspaceRootScopeKey(useWriteWorkspaceStore.getState().workspaceRoot) ===
        workspaceRootScopeKey(workspaceRoot)
    }
    const writeState = useWriteWorkspaceStore.getState()
    const activeThread = input.activeThreadId
      ? input.threads.find((thread) => thread.id === input.activeThreadId) ?? null
      : null
    const pptRoute = input.route === 'write' || activeThread?.agentSurface === 'write'
      ? 'write' as const
      : 'chat' as const
    const requests = input.blocks.flatMap((block) => {
      if (handledBlockIdsRef.current.has(block.id)) return []
      const request = pptCanvasOpenRequestForBlock(block, {
        route: pptRoute,
        workspaceRoot: activeThread?.workspace || writeState.workspaceRoot || input.workspaceRoot,
        threadId: input.activeThreadId,
        sourcePath: writeState.activeFilePath
      })
      return request ? [request] : []
    })
    if (requests.length === 0) return
    for (const request of requests) handledBlockIdsRef.current.add(request.blockId)
    void (async () => {
      for (const request of requests) {
        if (request.target === 'write' && !requestIsCurrent(request.workspaceRoot)) {
          handledBlockIdsRef.current.delete(request.blockId)
          continue
        }
        const opened = await routePptCanvasOpenRequest(request, {
          openCode: (detail) => {
            const { target: _target, ...codeDetail } = detail
            requestCodeCanvasPanelOpen(codeDetail)
          },
          openWork: async (detail) => {
            if (!requestIsCurrent(detail.workspaceRoot)) return false
            const store = useWriteWorkspaceStore.getState()
            const board = await store.findOrCreatePptWhiteboard({
              workspaceRoot: detail.workspaceRoot,
              threadId: detail.threadId,
              workflowId: detail.workflowId,
              title: detail.title,
              childId: detail.childId,
              sourcePath: detail.sourcePath
            })
            if (!board) return false
            if (!requestIsCurrent(detail.workspaceRoot)) return false
            if (detail.pptState && !detail.pptProjectionRequired) {
              const updated = await useWriteWorkspaceStore.getState().updateWhiteboardPptState(
                board.id,
                { ...detail.pptState, childId: detail.childId }
              )
              if (!updated) return false
            }
            return true
          }
        })
        if (!opened) handledBlockIdsRef.current.delete(request.blockId)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [input.activeThreadId, input.blocks, input.route, input.threads, input.workspaceRoot])
}
