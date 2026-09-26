import { useEffect, useRef } from 'react'
import type { ChatBlock, NormalizedThread } from '../../agent/types'
import { sendCanvasTurnReceipt } from '../../design/canvas/canvas-receipt-sender'
import { workspaceRootScopeKey } from '../../lib/workspace-path'
import type { AppRoute } from '../../store/chat-store-types'
import { useChatStore } from '../../store/chat-store'
import { WORK_WHITEBOARD_DIR } from '../../write/work-whiteboard'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { normalizePath } from '../../write/write-workspace-store-helpers'
import type { WorkWhiteboard } from '../../write/write-workspace-store-types'
import {
  applyOpenExcalidrawScene,
  claimExcalidrawApplyRequest,
  excalidrawApplyKey,
  hasAnyExcalidrawApplyHandler,
  hasExcalidrawApplyHandler,
  type ExcalidrawApplyResult
} from '../../whiteboard/excalidraw-apply'
import {
  excalidrawWorkbenchRequestFromBlock,
  type ExcalidrawWorkbenchRequest
} from './workbench-excalidraw-routing'

const HANDLER_WAIT_MS = 3000
const HANDLER_POLL_MS = 60

type EnsureErrorCode =
  | 'workspace_mismatch'
  | 'invalid_id'
  | 'engine_locked'
  | 'create_failed'

const ENSURE_ERROR_MAP: Record<EnsureErrorCode, { code: string; message: string; suggestion?: string }> = {
  workspace_mismatch: {
    code: 'EXCALIDRAW_WORKSPACE_MISMATCH',
    message: 'The whiteboard request targets a workspace that is no longer active.'
  },
  invalid_id: {
    code: 'EXCALIDRAW_BOARD_ID_INVALID',
    message: 'The requested boardId is not a valid whiteboard id.'
  },
  engine_locked: {
    code: 'EXCALIDRAW_ENGINE_LOCKED',
    message: 'The matching whiteboard cannot switch to the Excalidraw engine.',
    suggestion: 'Call design_open_excalidraw with a different boardId, or ask the user which board to use.'
  },
  create_failed: {
    code: 'EXCALIDRAW_BOARD_CREATE_FAILED',
    message: 'The renderer could not create the Excalidraw whiteboard.'
  }
}

async function waitForApplyHandler(key: string, timeoutMs = HANDLER_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (hasExcalidrawApplyHandler(key)) return true
    await new Promise((resolve) => setTimeout(resolve, HANDLER_POLL_MS))
  }
  return hasExcalidrawApplyHandler(key)
}

function mountedBoardOwnsApply(workspaceRoot: string, request: ExcalidrawWorkbenchRequest): boolean {
  if (request.action !== 'apply') return false
  const root = normalizePath(workspaceRoot)
  return request.boardId
    ? hasExcalidrawApplyHandler(excalidrawApplyKey(root, request.boardId, WORK_WHITEBOARD_DIR))
    : hasAnyExcalidrawApplyHandler(root, WORK_WHITEBOARD_DIR)
}

function receiptErrors(code: string, message: string, suggestion?: string): [{ code: string; message: string; suggestion?: string }] {
  return [{ code, message, ...(suggestion ? { suggestion } : {}) }]
}

async function handleOpenRequest(
  request: ExcalidrawWorkbenchRequest & { action: 'open' },
  threadId: string,
  workspaceRoot: string
): Promise<void> {
  const ensured = await useWriteWorkspaceStore.getState().findOrCreateExcalidrawWhiteboard({
    workspaceRoot,
    ...(request.boardId ? { boardId: request.boardId } : {}),
    ...(request.title ? { title: request.title } : {}),
    threadId
  })
  if (!ensured.ok) {
    const mapped = ENSURE_ERROR_MAP[ensured.code]
    sendCanvasTurnReceipt({
      threadId,
      turnId: request.turnId,
      receiptKey: request.receiptKey,
      affectedIds: [],
      errors: receiptErrors(mapped.code, mapped.message, mapped.suggestion)
    })
    return
  }
  // The board opens asynchronously; confirm the apply handler mounted so a
  // follow-up design_apply_excalidraw in the same turn finds it ready.
  await waitForApplyHandler(
    excalidrawApplyKey(ensured.board.workspaceRoot, ensured.board.id, WORK_WHITEBOARD_DIR)
  )
  sendCanvasTurnReceipt({
    threadId,
    turnId: request.turnId,
    receiptKey: request.receiptKey,
    affectedIds: [`excalidraw:${ensured.board.id}`],
    errors: []
  })
}

async function handleApplyRequest(
  request: ExcalidrawWorkbenchRequest & { action: 'apply' },
  threadId: string,
  workspaceRoot: string
): Promise<void> {
  const ensured = await useWriteWorkspaceStore.getState().findOrCreateExcalidrawWhiteboard({
    workspaceRoot,
    ...(request.boardId ? { boardId: request.boardId } : {}),
    threadId
  })
  if (!ensured.ok) {
    const mapped = ENSURE_ERROR_MAP[ensured.code]
    sendCanvasTurnReceipt({
      threadId,
      turnId: request.turnId,
      receiptKey: request.receiptKey,
      affectedIds: [],
      errors: receiptErrors(mapped.code, mapped.message, mapped.suggestion)
    })
    return
  }
  const board: WorkWhiteboard = ensured.board
  const handlerReady = await waitForApplyHandler(
    excalidrawApplyKey(board.workspaceRoot, board.id, WORK_WHITEBOARD_DIR)
  )
  if (!handlerReady) {
    sendCanvasTurnReceipt({
      threadId,
      turnId: request.turnId,
      receiptKey: request.receiptKey,
      affectedIds: [],
      errors: receiptErrors(
        'EXCALIDRAW_BOARD_OPEN_TIMEOUT',
        `The Excalidraw board ${board.id} did not mount in time.`,
        'Retry design_apply_excalidraw once the board is visible.'
      )
    })
    return
  }
  let result: ExcalidrawApplyResult
  try {
    result = await applyOpenExcalidrawScene(
      board.workspaceRoot,
      board.id,
      WORK_WHITEBOARD_DIR,
      request.exportPath
    )
  } catch (error) {
    result = {
      ok: false,
      error: {
        code: 'EXCALIDRAW_APPLY_FAILED',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
  const failureSuggestion = !result.ok
    ? result.error.code === 'EXCALIDRAW_SCENE_EMPTY' || !result.error.suggestion
      ? `Write .kun-whiteboards/${board.id}/excalidraw.json, then retry design_apply_excalidraw.`
      : result.error.suggestion
    : undefined
  sendCanvasTurnReceipt({
    threadId,
    turnId: request.turnId,
    receiptKey: request.receiptKey,
    affectedIds: result.ok ? [`excalidraw:${board.id}`] : [],
    errors: result.ok
      ? []
      : receiptErrors(result.error.code, result.error.message, failureSuggestion),
    ...(result.ok
      ? {
          generatedFiles: [
            {
              name: 'excalidraw.png',
              relativePath: result.pngRelativePath,
              mimeType: 'image/png' as const,
              byteSize: result.pngByteSize
            },
            ...(result.exportedPath
              ? [{
                  name: result.exportedPath.slice(result.exportedPath.lastIndexOf('/') + 1),
                  relativePath: result.exportedPath,
                  mimeType: 'image/png' as const,
                  byteSize: result.pngByteSize
                }]
              : [])
          ]
        }
      : {})
  })
}

/**
 * Fulfills design_open_excalidraw / design_apply_excalidraw requests for the
 * Work surface when no mounted Excalidraw board can serve them: the router
 * opens (or creates) the conversation's bound board, then applies the scene.
 */
export function useWorkbenchExcalidrawRouter(input: {
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
    const activeThread = input.activeThreadId
      ? input.threads.find((thread) => thread.id === input.activeThreadId) ?? null
      : null
    if (input.route !== 'write' && activeThread?.agentSurface !== 'write') return
    const threadId = input.activeThreadId?.trim()
    if (!threadId) return
    const workspaceRoot = (
      activeThread?.workspace ||
      useWriteWorkspaceStore.getState().workspaceRoot ||
      input.workspaceRoot
    ).trim()
    if (!workspaceRoot || !requestIsCurrent(workspaceRoot)) return
    const requests = input.blocks.flatMap((block) => {
      if (handledBlockIdsRef.current.has(block.id)) return []
      const request = excalidrawWorkbenchRequestFromBlock(
        block,
        useChatStore.getState().currentTurnId
      )
      return request ? [request] : []
    })
    if (requests.length === 0) return
    void (async () => {
      for (const request of requests) {
        if (!requestIsCurrent(workspaceRoot)) return
        if (mountedBoardOwnsApply(workspaceRoot, request)) {
          handledBlockIdsRef.current.add(request.blockId)
          continue
        }
        if (!claimExcalidrawApplyRequest(request.blockId)) {
          handledBlockIdsRef.current.add(request.blockId)
          continue
        }
        handledBlockIdsRef.current.add(request.blockId)
        try {
          if (request.action === 'open') await handleOpenRequest(request, threadId, workspaceRoot)
          else await handleApplyRequest(request, threadId, workspaceRoot)
        } catch (error) {
          sendCanvasTurnReceipt({
            threadId,
            turnId: request.turnId,
            receiptKey: request.receiptKey,
            affectedIds: [],
            errors: receiptErrors(
              'EXCALIDRAW_REQUEST_FAILED',
              error instanceof Error ? error.message : String(error)
            )
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [input.activeThreadId, input.blocks, input.route, input.threads, input.workspaceRoot])
}
