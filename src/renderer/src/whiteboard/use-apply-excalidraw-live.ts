import { useEffect } from 'react'
import type { ToolBlock } from '../agent/types'
import { sendCanvasTurnReceipt } from '../design/canvas/canvas-receipt-sender'
import { useChatStore } from '../store/chat-store'
import {
  applyOpenExcalidrawScene,
  claimExcalidrawApplyRequest,
  DESIGN_APPLY_EXCALIDRAW_TOOL_NAME,
  type ExcalidrawApplyResult
} from './excalidraw-apply'

export type ExcalidrawApplyRequest = {
  receiptKey: string
  turnId: string
  boardId?: string
  surface?: string
}

export function excalidrawApplyRequestFromBlock(
  block: ToolBlock,
  currentTurnId?: string | null
): ExcalidrawApplyRequest | null {
  const sourceItemKind = block.meta?.sourceItemKind
  if (
    block.status !== 'success' ||
    block.meta?.toolName !== DESIGN_APPLY_EXCALIDRAW_TOOL_NAME ||
    (sourceItemKind !== undefined && sourceItemKind !== 'tool_result')
  ) return null
  const detail = block.detail?.trim()
  if (!detail) return null
  try {
    const value = JSON.parse(detail) as Record<string, unknown>
    const receiptKey = typeof value.receiptKey === 'string' ? value.receiptKey.trim() : ''
    const turnId = block.turnId?.trim() || currentTurnId?.trim() || ''
    if (
      value.tool !== DESIGN_APPLY_EXCALIDRAW_TOOL_NAME ||
      value.action !== 'apply_excalidraw' ||
      value.status !== 'accepted' ||
      !receiptKey ||
      !turnId
    ) return null
    const boardId = typeof value.boardId === 'string' ? value.boardId.trim() : ''
    const surface = typeof value.surface === 'string' ? value.surface.trim() : ''
    return {
      receiptKey,
      turnId,
      ...(boardId ? { boardId } : {}),
      ...(surface ? { surface } : {})
    }
  } catch {
    return null
  }
}

/** Reloads the open Excalidraw board after design_apply_excalidraw is accepted. */
export function useApplyExcalidrawLive(input: {
  enabled: boolean
  threadId: string | null | undefined
  workspaceRoot: string
  identityId: string
  baseDir: string
  surface?: 'write' | 'code' | 'design'
}): void {
  useEffect(() => {
    const threadId = input.threadId?.trim()
    if (!input.enabled || !threadId || !input.workspaceRoot.trim() || !input.identityId.trim()) return
    const process = (state: ReturnType<typeof useChatStore.getState>): void => {
      if (state.activeThreadId !== threadId) return
      for (const block of state.blocks) {
        if (block.kind !== 'tool') continue
        const request = excalidrawApplyRequestFromBlock(block, state.currentTurnId)
        if (!request) continue
        // Surface-stamped requests only belong to hooks on that surface; a
        // stamped request must never be applied by a stale mount elsewhere.
        if (request.surface && request.surface !== input.surface) continue
        // A boardId-targeted request belongs to exactly that board; the
        // workbench router covers the case where it is not mounted yet.
        if (request.boardId && request.boardId !== input.identityId) continue
        // The workbench router races this hook for unmounted boards; the
        // first claimant applies exactly once.
        if (!claimExcalidrawApplyRequest(block.id)) continue
        void (async () => {
          let result: ExcalidrawApplyResult
          try {
            result = await applyOpenExcalidrawScene(
              input.workspaceRoot,
              input.identityId,
              input.baseDir
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
          sendCanvasTurnReceipt({
            threadId,
            turnId: request.turnId,
            receiptKey: request.receiptKey,
            affectedIds: result.ok ? [`excalidraw:${input.identityId}`] : [],
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
        })()
      }
    }

    process(useChatStore.getState())
    return useChatStore.subscribe(process)
  }, [input.baseDir, input.enabled, input.identityId, input.surface, input.threadId, input.workspaceRoot])
}
