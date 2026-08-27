import type { ChatBlock } from '../../agent/types'
import { collectAssistantTextForTurn } from '../../store/chat-store-runtime-helpers'
import {
  activeCanvasUserId,
  placeLiveCanvasTurnImages
} from './canvas-design-replay-support'
import {
  blocksForActiveCanvasTurn,
  canvasReplayContextForActiveTurn,
  type CanvasDesignDocumentTarget,
  type CanvasTurnReplayState
} from './canvas-design-turn-replay'
import type { GeneratedImageFallbackTarget } from './canvas-generated-image-replay'
import { imageGenerationPlaceholderShapeId } from './canvas-image-generation-progress'
import type { ExecuteOpsOptions, OpError } from './shape-ops'
import type { useCanvasSelectionStore } from './canvas-selection-store'
import { useDesignAssistantStore } from '../design-assistant-store'
import { applyCanvasOpsSince } from './apply-shape-ops'

type SelectionStore = ReturnType<typeof useCanvasSelectionStore.getState>
type DesignAssistantStore = ReturnType<typeof useDesignAssistantStore.getState>

type StreamingChatState = {
  currentTurnId: string | null
  currentTurnUserId?: string | null
  blocks: ChatBlock[]
  liveAssistant: string
  activeThreadId: string | null
}

type DurableOpsSince = (
  text: string,
  startIndex: number,
  replayKey: string,
  executeOptions?: ExecuteOpsOptions
) => { affectedIds: string[]; errors: OpError[]; totalBlocks: number }

export type CanvasTurnStreamingContext = {
  activeDesignTarget?: CanvasDesignDocumentTarget
  targetThreadId?: string | null
  executeOptions?: ExecuteOpsOptions
  canvasDocumentReady: () => boolean
  getChatState: () => StreamingChatState
  getSelectionStore: () => SelectionStore
  getDesignAssistantStore: () => DesignAssistantStore
  affectedThisTurn: Set<string>
  errorsThisTurn: OpError[]
  getAppliedCount: () => number
  setAppliedCount: (value: number) => void
  getFramedThisTurn: () => boolean
  setFramedThisTurn: (value: boolean) => void
  applyDurableOpsSince: DurableOpsSince
}

/** Materialize any images generated during the active turn onto the canvas. */
export function materializeActiveGeneratedImages(
  context: CanvasTurnStreamingContext,
  state: CanvasTurnReplayState,
  generatedImageFallbackTarget: GeneratedImageFallbackTarget | null,
  generatedImagePlacementTargetId: string | null
): void {
  if (!context.activeDesignTarget || !state.currentTurnId || !context.canvasDocumentReady()) return
  const userId = activeCanvasUserId(state.blocks)
  if (!userId) return
  const user = state.blocks.find((block) => block.id === userId)
  const turnBlocks = blocksForActiveCanvasTurn({ ...state, currentTurnUserId: userId })
  const durableTurnBlocks = user ? [user, ...turnBlocks] : turnBlocks
  const placed = placeLiveCanvasTurnImages({
    blocks: durableTurnBlocks,
    affectedIds: [...context.affectedThisTurn],
    threadId: context.targetThreadId ?? state.activeThreadId,
    turnId: state.currentTurnId,
    target: context.activeDesignTarget,
    fallback: generatedImageFallbackTarget,
    fallbackPlacementTargetId: generatedImagePlacementTargetId,
    placeholderShapeIdForTool: imageGenerationPlaceholderShapeId
  })
  for (const id of placed) context.affectedThisTurn.add(id)
}

/**
 * The in-progress (or just-completed) turn's full assistant text. Using the
 * ASSEMBLED text — not raw `liveAssistant` — keeps the block cursor stable even
 * when a mid-turn tool call flushes a segment to a block and resets
 * `liveAssistant`; otherwise post-tool-call canvas ops would never stream and
 * the cursor would drift from the turn-complete flush.
 */
export function assembledTurnText(context: CanvasTurnStreamingContext): string {
  const s = context.getChatState()
  const userId = activeCanvasUserId(s.blocks)
  return userId ? collectAssistantTextForTurn(s.blocks, userId, s.liveAssistant) : s.liveAssistant
}

/**
 * Apply every not-yet-applied complete block in `text`, advancing the cursor.
 * `frameOnFirst` gently brings the build area into view exactly once per turn
 * (the first batch), then leaves the camera alone so the live build is smooth.
 */
export function applyCanvasStreamFrom(
  context: CanvasTurnStreamingContext,
  text: string,
  frameOnFirst: boolean
): void {
  const replay = canvasReplayContextForActiveTurn(
    context.getChatState(),
    context.targetThreadId,
    context.activeDesignTarget,
    'assistant'
  )
  const { affectedIds, errors, totalBlocks } = replay
    ? context.applyDurableOpsSince(text, context.getAppliedCount(), replay.replayKey, context.executeOptions)
    : applyCanvasOpsSince(text, context.getAppliedCount(), context.executeOptions)
  if (totalBlocks <= context.getAppliedCount()) return
  context.setAppliedCount(totalBlocks)
  if (errors.length > 0) context.errorsThisTurn.push(...errors)
  if (affectedIds.length === 0) return
  for (const id of affectedIds) context.affectedThisTurn.add(id)
  context.getSelectionStore().select([...context.affectedThisTurn])
  if (frameOnFirst && !context.getFramedThisTurn()) {
    context.setFramedThisTurn(true)
    // markAiAffected = glow + camera focus; do it once at the start so the
    // build area is in view, then stay put for the rest of the stream.
    context.getDesignAssistantStore().markAiAffected(affectedIds)
  } else {
    // Glow the freshly-touched shapes without yanking the camera mid-build.
    useDesignAssistantStore.setState({
      lastAiAffectedIds: affectedIds,
      lastAiActionAt: Date.now()
    })
  }
}
