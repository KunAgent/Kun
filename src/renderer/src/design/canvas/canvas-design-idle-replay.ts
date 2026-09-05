import type { ChatBlock, NormalizedThread, ToolBlock } from '../../agent/types'
import { threadHasPendingRuntimeWork } from '../../store/chat-store-runtime-helpers'
import {
  applyCanvasOpBlocks,
  extractCanvasOpBlocks,
  setLastCanvasOpErrors,
  type ApplyCanvasOpsSinceResult
} from './apply-shape-ops'
import {
  designImagePlacementTargetFromUserBlock,
  materializeHistoricalGeneratedImages,
  placeGeneratedImagesForTurn,
  replayDurableDesignCanvasTurns,
  type CanvasDesignDocumentTarget,
  type DurableDesignCanvasTurnCompletion
} from './canvas-design-turn-replay'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { useCanvasShapeStore } from './canvas-shape-store'
import type { ExecuteOpsOptions, OpError } from './shape-ops'
import { isDesignMotionRendererToolName } from './motion-ops'
import {
  replayDurableCodeCanvasToolBlocks,
  replayDurablePptCanvasToolBlocks
} from './canvas-code-turn-replay'
import {
  canvasDurableTurnOutcome,
  canvasTurnAllowsContinuation
} from './canvas-turn-outcome'

type IdleChatState = {
  activeThreadId: string | null
  currentTurnId: string | null
  busy: boolean
  blocks: ChatBlock[]
  threads?: readonly NormalizedThread[]
}

export function shouldReplayIdleCanvasToolBlock(block: ToolBlock): boolean {
  return block.meta?.toolName === 'design_svg_create' ||
    block.meta?.toolName === 'ppt_agent' ||
    isDesignMotionRendererToolName(block.meta?.toolName)
}

export function replayIdleCanvasToolBlocks(
  blocks: readonly ChatBlock[],
  applyToolBlock: (block: ToolBlock) => void,
  applySvgBlock: (block: ToolBlock) => void
): void {
  for (const block of blocks) {
    if (block.kind !== 'tool' || !shouldReplayIdleCanvasToolBlock(block)) continue
    if (isDesignMotionRendererToolName(block.meta?.toolName) || block.meta?.toolName === 'ppt_agent') {
      applyToolBlock(block)
    } else applySvgBlock(block)
  }
}

export function applyDurableCanvasOpsSince(
  text: string,
  startIndex: number,
  replayKey: string,
  executeOptions?: ExecuteOpsOptions
): ApplyCanvasOpsSinceResult {
  const blocks = extractCanvasOpBlocks(text)
  const affectedIds: string[] = []
  const errors: OpError[] = []
  for (let index = Math.max(0, startIndex); index < blocks.length; index += 1) {
    const result = applyCanvasOpBlocks([blocks[index]], `replay:${replayKey}:${index}`, {
      ...executeOptions,
      replayKey: `${replayKey}:${index}`
    })
    affectedIds.push(...result.affectedIds)
    errors.push(...result.errors)
  }
  return { affectedIds, errors, totalBlocks: blocks.length }
}

export function replayIdleDesignCanvas(options: {
  state: IdleChatState
  threadId?: string | null
  target?: CanvasDesignDocumentTarget
  ready: boolean
  executeOptions?: ExecuteOpsOptions
  errorKey?: string
  affectedIds: Set<string>
  errors: OpError[]
  resetTurn: () => void
  applyToolBlock: (
    block: ToolBlock,
    replay: { blocks: readonly ChatBlock[]; replayKey: string; turnId: string }
  ) => void
  onTurnReplayed?: (
    completion: DurableDesignCanvasTurnCompletion,
    affectedIds: readonly string[]
  ) => void
}): void {
  const { state, threadId, target } = options
  if (!target || !threadId || !options.ready) return
  if (state.activeThreadId !== threadId) return
  if (state.currentTurnId || state.busy || threadHasPendingRuntimeWork(state.blocks)) return
  replayDurableDesignCanvasTurns({
    threadId,
    blocks: state.blocks,
    target,
    onTurnStart: options.resetTurn,
    onAssistantText: (text, replayKey) => {
      const result = applyDurableCanvasOpsSince(text, 0, replayKey, options.executeOptions)
      result.affectedIds.forEach((id) => options.affectedIds.add(id))
      options.errors.push(...result.errors)
    },
    resolveTurnOutcome: (turnId) => canvasDurableTurnOutcome({
      threads: state.threads,
      threadId,
      turnId
    }),
    onToolBlock: (block, blocks, replayKey, turnId, outcome) => {
      if (
        block.meta?.toolName === 'design_svg_create' &&
        !canvasTurnAllowsContinuation(outcome)
      ) return
      options.applyToolBlock(block, { blocks, replayKey, turnId })
    },
    onTurnComplete: (completion) => {
      const placementTarget = designImagePlacementTargetFromUserBlock(
        completion.blocks.find((block) => block.kind === 'user')
      )
      const placedImages = placeGeneratedImagesForTurn({
        blocks: completion.blocks,
        affectedIds: [...options.affectedIds],
        threadId,
        turnId: completion.turnId,
        target,
        ...(placementTarget ? { placementTarget } : {})
      })
      placedImages.forEach((id) => options.affectedIds.add(id))
      const affectedIds = [...options.affectedIds]
      if (affectedIds.length > 0) useCanvasSelectionStore.getState().select(affectedIds)
      setLastCanvasOpErrors([...options.errors], options.errorKey)
      options.onTurnReplayed?.(completion, affectedIds)
    }
  })
  materializeHistoricalGeneratedImages({ threadId, blocks: state.blocks, target })
}

export function replayIdleCodeCanvas(options: {
  state: IdleChatState
  threadId?: string | null
  ready: boolean
  errorKey?: string
  affectedIds: Set<string>
  errors: OpError[]
  resetTurn: () => void
  applyToolBlock: (
    block: ToolBlock,
    replay: { blocks: readonly ChatBlock[]; replayKey: string; turnId: string }
  ) => void
}): void {
  const { state, threadId } = options
  if (!threadId || !options.ready || state.activeThreadId !== threadId) return
  if (state.currentTurnId || state.busy || threadHasPendingRuntimeWork(state.blocks)) return
  replayDurablePptCanvasToolBlocks({
    threadId,
    blocks: state.blocks,
    onToolBlock: (block, blocks, replayKey, turnId) =>
      options.applyToolBlock(block, { blocks, replayKey, turnId })
  })
  replayDurableCodeCanvasToolBlocks({
    threadId,
    blocks: state.blocks,
    document: useCanvasShapeStore.getState().document,
    onTurnStart: options.resetTurn,
    onToolBlock: (block, blocks, replayKey, turnId) =>
      options.applyToolBlock(block, { blocks, replayKey, turnId }),
    onTurnComplete: (turnId) => {
      const affectedIds = [...options.affectedIds]
      if (affectedIds.length > 0) useCanvasSelectionStore.getState().select(affectedIds)
      setLastCanvasOpErrors([...options.errors], options.errorKey)
      useCanvasShapeStore.getState().recordRendererReplayWatermark(turnId)
    }
  })
}
