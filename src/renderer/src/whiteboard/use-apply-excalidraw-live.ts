import { useEffect } from 'react'
import type { ToolBlock } from '../agent/types'
import { sendCanvasTurnReceipt } from '../design/canvas/canvas-receipt-sender'
import { useChatStore } from '../store/chat-store'
import {
  applyOpenExcalidrawScene,
  DESIGN_APPLY_EXCALIDRAW_TOOL_NAME,
  type ExcalidrawApplyResult
} from './excalidraw-apply'

export type ExcalidrawApplyRequest = {
  receiptKey: string
  turnId: string
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
    return { receiptKey, turnId }
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
}): void {
  useEffect(() => {
    const threadId = input.threadId?.trim()
    if (!input.enabled || !threadId || !input.workspaceRoot.trim() || !input.identityId.trim()) return
    const appliedBlockIds = new Set<string>()
    const inFlightBlockIds = new Set<string>()

    const process = (state: ReturnType<typeof useChatStore.getState>): void => {
      if (state.activeThreadId !== threadId) return
      for (const block of state.blocks) {
        if (
          block.kind !== 'tool' ||
          appliedBlockIds.has(block.id) ||
          inFlightBlockIds.has(block.id)
        ) continue
        const request = excalidrawApplyRequestFromBlock(block, state.currentTurnId)
        if (!request) continue
        inFlightBlockIds.add(block.id)
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
          } finally {
            inFlightBlockIds.delete(block.id)
            appliedBlockIds.add(block.id)
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
  }, [input.baseDir, input.enabled, input.identityId, input.threadId, input.workspaceRoot])
}
