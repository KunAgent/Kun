import { useEffect, type ReactElement } from 'react'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import { useRoomRun } from './useRoomRun'
import { sendCanvasTurnReceipt } from '../../design/canvas/canvas-receipt-sender'
import { WORK_WHITEBOARD_DIR } from '../../write/work-whiteboard'
import {
  applyOpenExcalidrawScene,
  exportExcalidrawPngSidecar,
  hasExcalidrawApplyHandler,
  excalidrawApplyKey,
  type ExcalidrawApplyResult
} from '../../whiteboard/excalidraw-apply'
import {
  prepareExcalidrawReload,
  isExcalidrawSceneEmpty,
  loadExcalidrawScene
} from '../../whiteboard/excalidraw-persistence'
import { useRoomExcalidrawStore } from './room-excalidraw-store'

const OPEN_TOOL = 'design_open_excalidraw'
const APPLY_TOOL = 'design_apply_excalidraw'

type RoomExcalidrawRequest = {
  action: 'open' | 'apply'
  receiptKey: string
  turnId: string
  threadId: string
  boardId: string
  title?: string
  workspaceRoot: string
}

const processedReceipts = new Set<string>()
const MAX_PROCESSED_RECEIPTS = 500

function outputRecord(output: unknown): Record<string, unknown> | null {
  if (output && typeof output === 'object' && !Array.isArray(output)) return output as Record<string, unknown>
  if (typeof output === 'string') {
    try {
      const parsed = JSON.parse(output) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
}

export function roomExcalidrawRequestFromItem(item: CoreTurnItemJson): RoomExcalidrawRequest | null {
  const toolName = item.toolName?.replace(/^mcp__kun__/, '')
  if (item.kind !== 'tool_result' || item.isError || (toolName !== OPEN_TOOL && toolName !== APPLY_TOOL)) return null
  const output = outputRecord(item.output)
  if (!output || output.scope !== 'room' || output.status !== 'accepted' || output.unverified === true) return null
  const receiptKey = typeof output.receiptKey === 'string' ? output.receiptKey.trim() : ''
  const turnId = item.turnId?.trim() ?? ''
  const threadId = item.threadId?.trim() ?? ''
  const workspaceRoot = typeof output.workspaceRoot === 'string' ? output.workspaceRoot : ''
  const boardId = typeof output.boardId === 'string' ? output.boardId : ''
  if (!receiptKey || !turnId || !threadId || !workspaceRoot || !boardId) return null
  return {
    action: toolName === OPEN_TOOL ? 'open' : 'apply',
    receiptKey,
    turnId,
    threadId,
    boardId,
    title: typeof output.title === 'string' ? output.title : undefined,
    workspaceRoot
  }
}

async function handleOpen(request: RoomExcalidrawRequest, roomId: string): Promise<void> {
  useRoomExcalidrawStore.getState().registerBoard({
    roomId,
    boardId: request.boardId,
    workspaceRoot: request.workspaceRoot,
    title: request.title
  })
  useRoomExcalidrawStore.getState().openBoard(roomId, request.boardId)
  sendCanvasTurnReceipt({
    threadId: request.threadId,
    turnId: request.turnId,
    receiptKey: request.receiptKey,
    affectedIds: [`excalidraw:${request.boardId}`],
    errors: []
  })
}

async function handleApply(request: RoomExcalidrawRequest): Promise<void> {
  let result: ExcalidrawApplyResult
  try {
    await prepareExcalidrawReload(request.workspaceRoot, request.boardId, WORK_WHITEBOARD_DIR)
    const key = excalidrawApplyKey(request.workspaceRoot, request.boardId, WORK_WHITEBOARD_DIR)
    if (hasExcalidrawApplyHandler(key)) {
      result = await applyOpenExcalidrawScene(
        request.workspaceRoot,
        request.boardId,
        WORK_WHITEBOARD_DIR
      )
    } else {
      const scene = await loadExcalidrawScene(request.workspaceRoot, request.boardId, WORK_WHITEBOARD_DIR)
      if (!scene || isExcalidrawSceneEmpty(scene)) {
        result = {
          ok: false,
          error: {
            code: 'EXCALIDRAW_SCENE_EMPTY',
            message: 'The canonical excalidraw.json is missing or has no live elements.',
            suggestion: 'Write the scene file first, then call design_apply_excalidraw.'
          }
        }
      } else {
        result = await exportExcalidrawPngSidecar({
          workspaceRoot: request.workspaceRoot,
          identityId: request.boardId,
          baseDir: WORK_WHITEBOARD_DIR,
          scene
        })
      }
    }
  } catch (error) {
    result = {
      ok: false,
      error: {
        code: 'EXCALIDRAW_APPLY_FAILED',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
  sendCanvasTurnReceipt({
    threadId: request.threadId,
    turnId: request.turnId,
    receiptKey: request.receiptKey,
    affectedIds: result.ok ? [`excalidraw:${request.boardId}`] : [],
    errors: result.ok ? [] : [result.error],
    ...(result.ok
      ? {
          generatedFiles: [{
            name: 'excalidraw.png',
            relativePath: result.pngRelativePath,
            mimeType: 'image/png' as const,
            byteSize: result.pngByteSize
          }]
        }
      : {})
  })
}

function useProcessRoomExcalidrawRequests(roomId: string, items: CoreTurnItemJson[]): void {
  useEffect(() => {
    for (const item of items) {
      const request = roomExcalidrawRequestFromItem(item)
      if (!request || processedReceipts.has(request.receiptKey)) continue
      if (processedReceipts.size >= MAX_PROCESSED_RECEIPTS) {
        const oldest = processedReceipts.values().next().value
        if (oldest !== undefined) processedReceipts.delete(oldest)
      }
      processedReceipts.add(request.receiptKey)
      if (request.action === 'open') void handleOpen(request, roomId)
      else void handleApply(request)
    }
  }, [items, roomId])
}

/**
 * Consumes room-scoped design_open_excalidraw / design_apply_excalidraw tool
 * results for an active private-chat run and fulfills their canvas receipts.
 * It is mounted once per room at the workspace level, never inside the run
 * inspector or tool-progress collapse, so folding progress does not stop it.
 */
export function RoomExcalidrawConsumer({ roomId, runId }: { roomId: string; runId?: string }): ReactElement | null {
  if (!runId) return null
  return <RoomExcalidrawConsumerActive roomId={roomId} runId={runId} />
}

function RoomExcalidrawConsumerActive({ roomId, runId }: { roomId: string; runId: string }): ReactElement | null {
  const { items, detail } = useRoomRun(roomId, runId, true)
  const liveItems = detail && ['queued', 'running'].includes(detail.run.status)
    ? items.filter((item) => item.threadId === detail.run.threadId && item.turnId === detail.run.turnId) : []
  useProcessRoomExcalidrawRequests(roomId, liveItems)
  return null
}
