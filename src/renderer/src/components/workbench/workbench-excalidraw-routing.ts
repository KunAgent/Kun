import type { ChatBlock } from '../../agent/types'

export const EXCALIDRAW_OPEN_TOOL_NAME = 'design_open_excalidraw'
export const EXCALIDRAW_APPLY_TOOL_NAME = 'design_apply_excalidraw'

export type ExcalidrawWorkbenchRequest =
  | {
      action: 'open'
      blockId: string
      receiptKey: string
      turnId: string
      boardId?: string
      title?: string
    }
  | {
      action: 'apply'
      blockId: string
      receiptKey: string
      turnId: string
      boardId?: string
    }

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Reads accepted design_*_excalidraw tool results that need workbench-level
 * handling: opening a board that is not mounted yet, or applying a scene to a
 * board that may have to be opened first. Mounted boards handle their own
 * apply blocks through useApplyExcalidrawLive.
 */
export function excalidrawWorkbenchRequestFromBlock(
  block: ChatBlock,
  currentTurnId?: string | null
): ExcalidrawWorkbenchRequest | null {
  if (block.kind !== 'tool' || block.status !== 'success') return null
  const sourceItemKind = block.meta?.sourceItemKind
  if (sourceItemKind !== undefined && sourceItemKind !== 'tool_result') return null
  const detail = block.detail?.trim()
  if (!detail) return null
  let value: Record<string, unknown>
  try {
    const parsed = JSON.parse(detail) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    value = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const receiptKey = nonEmptyString(value.receiptKey)
  const turnId = nonEmptyString(block.turnId) ?? nonEmptyString(currentTurnId)
  if (value.status !== 'accepted' || !receiptKey || !turnId) return null
  // Requests stamped for another surface are served by that surface's hooks.
  const surface = nonEmptyString(value.surface)
  if (surface && surface !== 'write') return null
  const boardId = nonEmptyString(value.boardId)
  if (value.tool === EXCALIDRAW_OPEN_TOOL_NAME && value.action === 'open_excalidraw') {
    return {
      action: 'open',
      blockId: block.id,
      receiptKey,
      turnId,
      ...(boardId ? { boardId } : {}),
      ...(nonEmptyString(value.title) ? { title: nonEmptyString(value.title) } : {})
    }
  }
  if (value.tool === EXCALIDRAW_APPLY_TOOL_NAME && value.action === 'apply_excalidraw') {
    return {
      action: 'apply',
      blockId: block.id,
      receiptKey,
      turnId,
      ...(boardId ? { boardId } : {})
    }
  }
  return null
}
