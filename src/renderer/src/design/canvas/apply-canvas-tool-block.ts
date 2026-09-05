import type { ChatBlock, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { useCanvasShapeStore } from './canvas-shape-store'
import type { ExecuteOpsOptions, OpError } from './shape-ops'
import { useDesignAssistantStore } from '../design-assistant-store'
import {
  applyCanvasOpBlocks,
  extractCanvasOpBlocksFromValue
} from './apply-shape-ops'
import {
  applySvgArtifactToolBlock,
  shouldApplyDesignCanvasToolBlock,
  type SvgArtifactRequestHandler
} from './svg-artifact-tool-replay'
import { designSystemToolRevisionError, persistAppliedDesignSystemTool } from './design-system-tool-replay'
import { dispatchCanvasExportToolBlock, type CanvasAgentExportRequestHandler } from './canvas-export-tool-replay'
import {
  executeMotionOps,
  extractMotionOpsFromValue,
  isDesignMotionRendererToolName
} from './motion-ops'
import {
  coalesceGeneratedImageAddsForTurn,
  rewriteGeneratedImageUrlsForTurn
} from './canvas-generated-image-replay'
import {
  blocksForActiveCanvasTurn
} from './canvas-design-turn-replay'
import type { CanvasReplayBarrierState } from './canvas-design-replay-support'
import {
  projectPptCanvasBundle,
  resolvePptCanvasProjection,
  type PptCanvasProjectionOpenRequest
} from './ppt-canvas-projection'

/**
 * Apply a single assistant tool block to the live design canvas: PPT
 * projection, canvas export, motion ops, SVG artifact creation, design-system
 * tools, and plain ShapeOps. Mutable per-turn state is passed in via `ctx` so
 * the live-streaming hook stays the single owner of the turn's lifecycle.
 */
export type CanvasToolBlockApplyContext = {
  targetThreadId: string | null | undefined
  executeOptions?: ExecuteOpsOptions
  pptProjectionWorkflowId?: string
  pptProjectionChildId?: string
  onPptProjectionOpenRequested?: (request: PptCanvasProjectionOpenRequest) => void
  onCanvasExportRequested?: CanvasAgentExportRequestHandler
  onSvgArtifactRequested?: SvgArtifactRequestHandler
  appliedToolBlockIds: Set<string>
  processingSvgToolBlockIds: Set<string>
  pendingSvgToolBlocks: Map<string, ToolBlock>
  svgSourceTurnIds: Map<string, string>
  svgRetryCounts: Map<string, number>
  replayBarriers: Map<string, CanvasReplayBarrierState>
  affectedThisTurn: Set<string>
  errorsThisTurn: OpError[]
  framedThisTurn: { value: boolean }
  ensureReplayBarrier: (turnId: string) => CanvasReplayBarrierState | null
  scheduleSvgDrain: (delay?: number) => void
  commitReadyWatermarks: () => void
  markFailedSvgForRetry: (input: {
    blockId: string
    block: ToolBlock
    retryCounts: Map<string, number>
    pendingBlocks: Map<string, ToolBlock>
    schedule: () => void
  }) => void
  applySvgToolBlock: (
    block: ToolBlock,
    allowLegacy?: boolean,
    sourceTurnId?: string
  ) => Promise<void>
  sendToolReceipt?: (input: {
    receiptKey: string
    turnId: string
    affectedIds: readonly string[]
    errors: readonly OpError[]
  }) => void
}

function receiptKeyFromResult(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const key = (value as Record<string, unknown>).receiptKey
  return typeof key === 'string' && key.trim() ? key.trim() : null
}

function sendToolReceipt(
  block: ToolBlock,
  parsed: unknown,
  replay: { turnId: string } | undefined,
  ctx: CanvasToolBlockApplyContext,
  affectedIds: readonly string[],
  errors: readonly OpError[]
): void {
  const receiptKey = receiptKeyFromResult(parsed)
  const turnId = replay?.turnId || block.turnId?.trim() || useChatStore.getState().currentTurnId
  if (!receiptKey || !turnId) return
  ctx.sendToolReceipt?.({ receiptKey, turnId, affectedIds, errors })
}

export function applyCanvasToolBlock(
  block: ToolBlock,
  replay: { blocks: readonly ChatBlock[]; replayKey: string; turnId: string } | undefined,
  ctx: CanvasToolBlockApplyContext
): void {
  if (ctx.appliedToolBlockIds.has(block.id)) return
  const detail = block.detail?.trim()
  if (!detail) return
  let parsed: unknown
  try {
    parsed = JSON.parse(detail)
  } catch {
    return
  }
  const pptCanvasProjection = resolvePptCanvasProjection(
    typeof block.meta?.toolName === 'string' ? block.meta.toolName : undefined,
    parsed,
    ctx.pptProjectionWorkflowId,
    ctx.pptProjectionChildId
  )
  if (!pptCanvasProjection && !shouldApplyDesignCanvasToolBlock(block)) return
  if (pptCanvasProjection) {
    if (pptCanvasProjection.kind === 'filtered') {
      ctx.appliedToolBlockIds.add(block.id)
      return
    }
    const projectionResult = projectPptCanvasBundle({
      blockId: block.id,
      projection: pptCanvasProjection,
      targetThreadId: ctx.targetThreadId,
      executeOptions: ctx.executeOptions,
      affectedThisTurn: ctx.affectedThisTurn,
      errorsThisTurn: ctx.errorsThisTurn,
      onOpenRequested: ctx.onPptProjectionOpenRequested
    })
    if (projectionResult !== 'retry') ctx.appliedToolBlockIds.add(block.id)
    if (projectionResult === 'applied') ctx.framedThisTurn.value = true
    return
  }
  const chatState = useChatStore.getState()
  parsed = rewriteGeneratedImageUrlsForTurn(
    parsed,
    replay?.blocks ?? blocksForActiveCanvasTurn({
        activeThreadId: chatState.activeThreadId,
        currentTurnId: chatState.currentTurnId,
        currentTurnUserId: chatState.currentTurnUserId,
        blocks: chatState.blocks
      })
  )
  parsed = coalesceGeneratedImageAddsForTurn(
    parsed,
    replay?.blocks ?? blocksForActiveCanvasTurn({
      activeThreadId: chatState.activeThreadId,
      currentTurnId: chatState.currentTurnId,
      currentTurnUserId: chatState.currentTurnUserId,
      blocks: chatState.blocks
    }),
    useCanvasShapeStore.getState().document
  )
  if (dispatchCanvasExportToolBlock(
    block,
    parsed,
    ctx.appliedToolBlockIds,
    ctx.onCanvasExportRequested,
    {
      threadId: ctx.targetThreadId ?? chatState.activeThreadId,
      turnId: replay?.turnId ?? block.turnId
    }
  )) return
  if (isDesignMotionRendererToolName(block.meta?.toolName)) {
    const motionOps = extractMotionOpsFromValue(parsed)
    const { affectedIds, errors } = executeMotionOps(
      motionOps,
      `tool:${block.id}`,
      { replayKey: block.id }
    )
    // Mark even invalid/rejected renderer output as consumed. Otherwise a
    // remount in the same turn would repeatedly surface the same bounded
    // error; successfully applied batches also have a durable journal guard.
    ctx.appliedToolBlockIds.add(block.id)
    if (errors.length > 0) ctx.errorsThisTurn.push(...errors)
    sendToolReceipt(block, parsed, replay, ctx, affectedIds, errors)
    if (affectedIds.length === 0) return
    for (const id of affectedIds) ctx.affectedThisTurn.add(id)
    useCanvasSelectionStore.getState().select(
      [...ctx.affectedThisTurn].filter((id) => Boolean(useCanvasShapeStore.getState().document.objects[id]))
    )
    if (!ctx.framedThisTurn.value) {
      ctx.framedThisTurn.value = true
      useDesignAssistantStore.getState().markAiAffected(affectedIds)
    } else {
      useDesignAssistantStore.setState({
        lastAiAffectedIds: affectedIds,
        lastAiActionAt: Date.now()
      })
    }
    return
  }
  if (block.meta?.toolName === 'design_svg_create') {
    // A dedicated SVG turn must start only after the canvas turn becomes
    // idle. Otherwise sendMessage puts it into a process-global transient
    // queue that is discarded on thread switches. Stable-id results are
    // also replayed below after remount/restart when the artifact is absent
    // or still pending without a corresponding follow-up user turn.
    const sourceTurnId = replay?.turnId || chatState.currentTurnId || block.turnId || ''
    if (sourceTurnId) {
      ctx.svgSourceTurnIds.set(block.id, sourceTurnId)
      ctx.ensureReplayBarrier(sourceTurnId)?.pendingSvgBlockIds.add(block.id)
    }
    if (chatState.currentTurnId) ctx.pendingSvgToolBlocks.set(block.id, block)
    else void ctx.applySvgToolBlock(block, true, sourceTurnId)
    return
  }
  const revisionError = designSystemToolRevisionError(block.meta?.toolName, parsed)
  if (revisionError) {
    ctx.appliedToolBlockIds.add(block.id)
    ctx.errorsThisTurn.push(revisionError)
    sendToolReceipt(block, parsed, replay, ctx, [], [revisionError])
    return
  }
  const blocks = extractCanvasOpBlocksFromValue(parsed)
  if (blocks.length === 0) {
    ctx.appliedToolBlockIds.add(block.id)
    sendToolReceipt(block, parsed, replay, ctx, [], [])
    return
  }
  const { affectedIds, errors } = applyCanvasOpBlocks(
    blocks,
    `tool:${block.id}`,
    replay ? { ...ctx.executeOptions, replayKey: replay.replayKey } : ctx.executeOptions
  )
  ctx.appliedToolBlockIds.add(block.id)
  if (errors.length > 0) ctx.errorsThisTurn.push(...errors)
  sendToolReceipt(block, parsed, replay, ctx, affectedIds, errors)
  persistAppliedDesignSystemTool(block.meta?.toolName, errors)
  if (affectedIds.length === 0) return
  for (const id of affectedIds) ctx.affectedThisTurn.add(id)
  useCanvasSelectionStore.getState().select([...ctx.affectedThisTurn])
  if (!ctx.framedThisTurn.value) {
    ctx.framedThisTurn.value = true
    useDesignAssistantStore.getState().markAiAffected(affectedIds)
  } else {
    useDesignAssistantStore.setState({
      lastAiAffectedIds: affectedIds,
      lastAiActionAt: Date.now()
    })
  }
}
