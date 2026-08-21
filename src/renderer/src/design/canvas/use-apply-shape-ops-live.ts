import { useEffect, useRef } from 'react'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { collectAssistantTextForTurn, threadHasPendingRuntimeWork } from '../../store/chat-store-runtime-helpers'
import { applyCanvasOpBlocks, applyCanvasOpsSince, extractCanvasOpBlocksFromValue, setLastCanvasOpErrors } from './apply-shape-ops'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { useCanvasShapeStore } from './canvas-shape-store'
import type { ExecuteOpsOptions, OpError } from './shape-ops'
import { useDesignAssistantStore } from '../design-assistant-store'
import { useDesignWorkspaceStore } from '../design-workspace-store'
import { sendCanvasTurnReceipt } from './canvas-receipt-sender'
import {
  applySvgArtifactToolBlock,
  type SvgArtifactRequestHandler
} from './svg-artifact-tool-replay'
import { dispatchCanvasExportToolBlock, type CanvasAgentExportRequestHandler } from './canvas-export-tool-replay'
import { isDesignMotionRendererToolName } from './motion-ops'
import {
  applyCanvasToolBlock
} from './apply-canvas-tool-block'
import type { GeneratedImageFallbackTarget } from './canvas-generated-image-replay'
import { imageGenerationPlaceholderShapeId } from './canvas-image-generation-progress'
import type {
  PptCanvasProjectionOpenRequest,
  PptCanvasProjectionOptions
} from './ppt-canvas-projection'
import {
  activeCanvasTurnMatchesDesignTarget,
  activeCanvasTurnMatchesThread,
  blocksForActiveCanvasTurn,
  canvasReplayStateForStoreUpdate,
  canvasReplayContextForActiveTurn,
  replayActiveCanvasTurn,
  type CanvasDesignDocumentTarget,
  type CanvasTurnReplayState
} from './canvas-design-turn-replay'
import { applyDurableCanvasOpsSince, replayIdleCanvasToolBlocks, replayIdleCodeCanvas,
  replayIdleDesignCanvas } from './canvas-design-idle-replay'
import {
  commitReadyCanvasReplayBarriers,
  activeCanvasUserId,
  captureCanvasGeneratedImageFallback,
  dispatchNextPendingScreen,
  enqueueCanvasTurnScreens,
  ensureCanvasReplayBarrier,
  hasDispatchedScreenFollowup,
  placeLiveCanvasTurnImages,
  recordReadyCanvasReplayWatermarks,
  markFailedSvgForRetry,
  type CanvasReplayBarrierState,
  type CanvasScreenCreatedHandler,
  type PendingScreenGeneration
} from './canvas-design-replay-support'

export {
  hasDispatchedSvgFollowup, shouldApplyDesignCanvasToolBlock,
  shouldApplyDurableSvgCreate, userTextBeforeToolBlock
} from './svg-artifact-tool-replay'
export {
  latestGeneratedImageRelativePathForTurn,
  latestGeneratedImageUrlForTurn,
  looksLikeExistingCanvasImageEditRequest,
  resolveGeneratedImageFallbackTarget,
  rewriteGeneratedImageUrlsForTurn
} from './canvas-generated-image-replay'
export {
  activeCanvasTurnMatchesThread,
  canvasReplayStateForStoreUpdate,
  replayActiveCanvasTurn
} from './canvas-design-turn-replay'
export { shouldReplayIdleCanvasToolBlock } from './canvas-design-idle-replay'
export type {
  PptCanvasProjectionOpenRequest,
  PptCanvasProjectionOptions
} from './ppt-canvas-projection'
export {
  commitReadyCanvasReplayBarriers,
  hasDispatchedScreenFollowup,
  takeNextReadyScreenGeneration
} from './canvas-design-replay-support'
export type { CanvasScreenCreatedHandler } from './canvas-design-replay-support'
/** Coalesce per-token `liveAssistant` deltas so we re-parse at most this often. */
const STREAM_THROTTLE_MS = 120

/**
 * Apply the `design_canvas` / legacy ```shapeops``` blocks the chat agent emits
 * — IN REAL TIME, as they stream — so the design draft builds up live on the
 * canvas instead of appearing all at once when the turn ends.
 *
 * Each completed fenced block is executed the moment its closing ``` arrives in
 * `liveAssistant`; a per-turn cursor (`appliedCount`) guarantees every block runs
 * exactly once across the streaming passes and the final turn-complete flush.
 * Because the agent is encouraged to emit many small batches (one per logical
 * group — a frame, then its children, then the next section), the user watches
 * the layout materialize piece by piece, and add_screen frames pop in instantly
 * while their HTML generation is kicked off at turn end.
 *
 * Used in both design mode (DesignCanvas) and code mode (CodeCanvasPanel) —
 * wherever a CanvasViewport is rendered alongside a chat thread that may emit
 * canvas operations.
 */
export function useApplyShapeOpsLive(
  enabled: boolean,
  onScreenCreated?: CanvasScreenCreatedHandler,
  executeOptions?: ExecuteOpsOptions,
  errorKey?: string,
  targetThreadId?: string | null,
  onSvgArtifactRequested?: SvgArtifactRequestHandler,
  onCanvasExportRequested?: CanvasAgentExportRequestHandler,
  designDocumentTarget?: CanvasDesignDocumentTarget,
  expectedCanvasDocumentKey?: string,
  pptProjection?: PptCanvasProjectionOptions,
  durableReplaySurface?: 'code' | 'work'
): void {
  const onScreenCreatedRef = useRef(onScreenCreated)
  onScreenCreatedRef.current = onScreenCreated
  const onSvgArtifactRequestedRef = useRef(onSvgArtifactRequested)
  onSvgArtifactRequestedRef.current = onSvgArtifactRequested
  const designDocumentTargetRef = useRef(designDocumentTarget)
  designDocumentTargetRef.current = designDocumentTarget
  const onPptProjectionOpenRequestedRef = useRef(pptProjection?.onOpenRequested)
  onPptProjectionOpenRequestedRef.current = pptProjection?.onOpenRequested
  const pptProjectionWorkflowId = pptProjection?.workflowId?.trim() || undefined
  const pptProjectionChildId = pptProjection?.childId?.trim() || undefined
  useEffect(() => {
    if (!enabled) return
    const activeDesignTarget = designDocumentTargetRef.current
    const unboundTargetPolicy = durableReplaySurface === 'code' ? 'untargeted' : 'any'
    // Per-turn streaming state. Lives in the subscription closure so it survives
    // across deltas without triggering React re-renders on every token.
    let appliedCount = 0
    const affectedThisTurn = new Set<string>()
    const errorsThisTurn: OpError[] = []
    let framedThisTurn = false
    let lastRunAt = 0
    let trailingTimer: ReturnType<typeof setTimeout> | null = null
    let screenDrainTimer: ReturnType<typeof setTimeout> | null = null
    let svgDrainTimer: ReturnType<typeof setTimeout> | null = null
    const appliedToolBlockIds = new Set<string>()
    const processingSvgToolBlockIds = new Set<string>()
    const pendingSvgToolBlocks = new Map<string, ToolBlock>()
    const svgSourceTurnIds = new Map<string, string>()
    const svgRetryCounts = new Map<string, number>()
    const replayBarriers = new Map<string, CanvasReplayBarrierState>()
    let disposed = false
    let generatedImageFallbackTarget: GeneratedImageFallbackTarget | null = null
    let generatedImagePlacementTargetId: string | null = null

    // Screens the agent creates via add_screen still need their HTML generated in
    // a follow-up turn. Several can be created in ONE turn, but those follow-up
    // turns must run one at a time on the shared chat thread — so queue them and
    // drain one per turn-completion. `screenGenSeen` guards against ever
    // re-enqueuing (hence regenerating) a frame across the run's lifetime.
    const pendingScreens: PendingScreenGeneration[] = []
    const screenGenSeen = new Set<string>()
    const canvasDocumentReady = (): boolean =>
      !expectedCanvasDocumentKey ||
      useCanvasShapeStore.getState().documentKey === expectedCanvasDocumentKey

    const resetTurn = (): void => {
      appliedCount = 0
      affectedThisTurn.clear()
      errorsThisTurn.length = 0
      framedThisTurn = false
      generatedImageFallbackTarget = null
      generatedImagePlacementTargetId = null
    }

    const ensureReplayBarrier = (turnId: string): CanvasReplayBarrierState | null =>
      ensureCanvasReplayBarrier(replayBarriers, turnId)

    const commitReadyWatermarks = (): void => {
      recordReadyCanvasReplayWatermarks({
        disposed,
        barriers: replayBarriers,
        record: (turnId) => useCanvasShapeStore.getState().recordRendererReplayWatermark(turnId)
      })
    }

    const captureGeneratedImageFallbackTarget = (state: CanvasTurnReplayState): void => {
      const captured = captureCanvasGeneratedImageFallback(state)
      generatedImageFallbackTarget = captured.fallback
      generatedImagePlacementTargetId = captured.placementTargetId
    }

    const materializeActiveGeneratedImages = (state: CanvasTurnReplayState): void => {
      if (!activeDesignTarget || !state.currentTurnId || !canvasDocumentReady()) return
      const userId = activeCanvasUserId(state.blocks)
      if (!userId) return
      const user = state.blocks.find((block) => block.id === userId)
      const turnBlocks = blocksForActiveCanvasTurn({ ...state, currentTurnUserId: userId })
      const durableTurnBlocks = user ? [user, ...turnBlocks] : turnBlocks
      const placed = placeLiveCanvasTurnImages({
        blocks: durableTurnBlocks,
        affectedIds: [...affectedThisTurn],
        threadId: targetThreadId ?? state.activeThreadId,
        turnId: state.currentTurnId,
        target: activeDesignTarget,
        fallback: generatedImageFallbackTarget,
        fallbackPlacementTargetId: generatedImagePlacementTargetId,
        placeholderShapeIdForTool: imageGenerationPlaceholderShapeId
      })
      for (const id of placed) affectedThisTurn.add(id)
    }

    // The in-progress (or just-completed) turn's full assistant text. Using the
    // ASSEMBLED text — not raw `liveAssistant` — keeps the block cursor stable
    // even when a mid-turn tool call (e.g. generate_image) flushes a segment to a
    // block and resets `liveAssistant`; otherwise post-tool-call canvas ops would
    // never stream and the cursor would drift from the turn-complete flush.
    const assembledTurnText = (): string => {
      const s = useChatStore.getState()
      const userId = activeCanvasUserId(s.blocks)
      return userId ? collectAssistantTextForTurn(s.blocks, userId, s.liveAssistant) : s.liveAssistant
    }

    // Apply every not-yet-applied complete block in `text`, advancing the cursor.
    // `frameOnFirst` gently brings the build area into view exactly once per turn
    // (the first batch), then leaves the camera alone so the live build is smooth.
    const applyFrom = (text: string, frameOnFirst: boolean): void => {
      const replay = canvasReplayContextForActiveTurn(
        useChatStore.getState(), targetThreadId, activeDesignTarget, 'assistant'
      )
      const { affectedIds, errors, totalBlocks } = replay
        ? applyDurableCanvasOpsSince(text, appliedCount, replay.replayKey, executeOptions)
        : applyCanvasOpsSince(text, appliedCount, executeOptions)
      if (totalBlocks <= appliedCount) return
      appliedCount = totalBlocks
      // Capture errors even when nothing applied — an all-failed block has errors
      // but no affected ids, and that's exactly what the agent must learn about.
      if (errors.length > 0) errorsThisTurn.push(...errors)
      if (affectedIds.length === 0) return
      for (const id of affectedIds) affectedThisTurn.add(id)
      useCanvasSelectionStore.getState().select([...affectedThisTurn])
      if (frameOnFirst && !framedThisTurn) {
        framedThisTurn = true
        // markAiAffected = glow + camera focus; do it once at the start so the
        // build area is in view, then stay put for the rest of the stream.
        useDesignAssistantStore.getState().markAiAffected(affectedIds)
      } else {
        // Glow the freshly-touched shapes without yanking the camera mid-build.
        useDesignAssistantStore.setState({
          lastAiAffectedIds: affectedIds,
          lastAiActionAt: Date.now()
        })
      }
    }

    const processStreaming = (): void => {
      lastRunAt = Date.now()
      if (!canvasDocumentReady() || !useChatStore.getState().currentTurnId) return
      applyFrom(assembledTurnText(), true)
    }

    const applySvgToolBlock = async (
      block: ToolBlock,
      allowLegacy = false,
      sourceTurnId = svgSourceTurnIds.get(block.id) ?? ''
    ): Promise<void> => {
      const onRequest = onSvgArtifactRequestedRef.current
      if (!onRequest) return
      const chatState = useChatStore.getState()
      const result = await applySvgArtifactToolBlock({
        block,
        allowLegacy,
        busy: Boolean(
          chatState.currentTurnId ||
          chatState.busy ||
          threadHasPendingRuntimeWork(chatState.blocks)
        ),
        blocks: chatState.blocks,
        artifacts: useDesignWorkspaceStore.getState().artifacts,
        appliedBlockIds: appliedToolBlockIds,
        processingBlockIds: processingSvgToolBlockIds,
        onDefer: (deferred) => {
          pendingSvgToolBlocks.set(deferred.id, deferred)
          scheduleSvgDrain()
        },
        onRequest
      }).catch(() => ({ status: 'failed' as const, shapeIds: [] }))
      if (result.shapeIds.length > 0) {
        useCanvasSelectionStore.getState().select(result.shapeIds)
        useDesignAssistantStore.getState().markAiAffected(result.shapeIds)
        framedThisTurn = true
      }
      if ((result.status === 'applied' || result.status === 'ignored') && sourceTurnId) {
        ensureReplayBarrier(sourceTurnId)?.pendingSvgBlockIds.delete(block.id)
        svgSourceTurnIds.delete(block.id)
        commitReadyWatermarks()
      } else if (result.status === 'failed' && sourceTurnId) {
        markFailedSvgForRetry({
          blockId: block.id, block, retryCounts: svgRetryCounts,
          pendingBlocks: pendingSvgToolBlocks, schedule: () => scheduleSvgDrain(400)
        })
      }
    }

    const applyToolBlock = (
      block: ToolBlock,
      replay?: { blocks: readonly ChatBlock[]; replayKey: string; turnId: string }
    ): void => {
      const framedRef = { value: framedThisTurn }
      applyCanvasToolBlock(block, replay, {
        targetThreadId,
        executeOptions,
        pptProjectionWorkflowId,
        pptProjectionChildId,
        onPptProjectionOpenRequested: onPptProjectionOpenRequestedRef.current,
        onCanvasExportRequested,
        onSvgArtifactRequested: onSvgArtifactRequestedRef.current,
        appliedToolBlockIds,
        processingSvgToolBlockIds,
        pendingSvgToolBlocks,
        svgSourceTurnIds,
        svgRetryCounts,
        replayBarriers,
        affectedThisTurn,
        errorsThisTurn,
        framedThisTurn: framedRef,
        ensureReplayBarrier,
        scheduleSvgDrain,
        commitReadyWatermarks,
        markFailedSvgForRetry,
        applySvgToolBlock,
        sendToolReceipt: ({ receiptKey, turnId, affectedIds, errors }) => {
          const threadId = targetThreadId ?? useChatStore.getState().activeThreadId
          if (!threadId) return
          sendCanvasTurnReceipt({ threadId, turnId, receiptKey, affectedIds, errors })
        }
      })
      // The extracted executor mutates framedThisTurn through the ref; sync
      // the closure copy back so later camera logic sees the updated value.
      framedThisTurn = framedRef.value
    }

    const scheduleStreaming = (): void => {
      const elapsed = Date.now() - lastRunAt
      if (elapsed >= STREAM_THROTTLE_MS) {
        processStreaming()
      } else if (!trailingTimer) {
        trailingTimer = setTimeout(() => {
          trailingTimer = null
          processStreaming()
        }, STREAM_THROTTLE_MS - elapsed)
      }
    }

    function scheduleScreenDrain(delay = 160): void {
      if (screenDrainTimer) return
      screenDrainTimer = setTimeout(() => {
        screenDrainTimer = null
        drainPendingScreens()
      }, delay)
    }

    function scheduleSvgDrain(delay = 120): void {
      if (svgDrainTimer) return
      svgDrainTimer = setTimeout(() => {
        svgDrainTimer = null
        drainPendingSvgBlocks()
      }, delay)
    }

    function drainPendingSvgBlocks(): void {
      if (pendingSvgToolBlocks.size === 0) return
      const chatState = useChatStore.getState()
      if (
        chatState.currentTurnId ||
        chatState.busy ||
        threadHasPendingRuntimeWork(chatState.blocks)
      ) {
        scheduleSvgDrain()
        return
      }
      const blocks = [...pendingSvgToolBlocks.values()]
      pendingSvgToolBlocks.clear()
      for (const block of blocks) {
        void applySvgToolBlock(block, true, svgSourceTurnIds.get(block.id) ?? '')
      }
    }

    // Kick off the next queued screen's HTML generation — but only while the
    // thread is fully idle, so the per-screen turns run strictly one at a time.
    // Turn completion and busy/currentTurnId clearing can land in separate store
    // ticks, so this function re-schedules itself instead of consuming too early.
    async function drainPendingScreens(): Promise<void> {
      if (pendingScreens.length === 0) return
      const chatState = useChatStore.getState()
      const pendingRuntimeWork = threadHasPendingRuntimeWork(chatState.blocks)
      const result = await dispatchNextPendingScreen({
        pendingScreens,
        document: useCanvasShapeStore.getState().document,
        currentTurnId: chatState.currentTurnId,
        busy: chatState.busy,
        pendingRuntimeWork,
        htmlArtifactIds: new Set(
          useDesignWorkspaceStore.getState().artifacts
            .filter((artifact) => artifact.kind === 'html')
            .map((artifact) => artifact.id)
        ),
        onDrop: (dropped) => {
          if (!dropped.sourceTurnId) return
          ensureReplayBarrier(dropped.sourceTurnId)?.pendingScreenIds.delete(dropped.shapeId)
          commitReadyWatermarks()
        },
        onDispatch: (pending) => {
          useCanvasSelectionStore.getState().select([pending.shapeId])
          return onScreenCreatedRef.current?.(
            pending.shapeId, pending.userPrompt, pending.brief
          ) ?? false
        }
      })
      if (disposed) return
      if (result.status === 'failed' && (result.pending?.attempts ?? 0) < 2) {
        scheduleScreenDrain(400)
        return
      }
      if (result.status === 'blocked') {
        if (pendingScreens.length > 0 && (chatState.currentTurnId || chatState.busy || pendingRuntimeWork)) {
          scheduleScreenDrain()
        }
        return
      }
      const dispatched = result.status === 'dispatched' ? result.pending : undefined
      if (dispatched?.sourceTurnId) {
        ensureReplayBarrier(dispatched.sourceTurnId)?.pendingScreenIds.delete(dispatched.shapeId)
        commitReadyWatermarks()
      }
    }

    // Final pass once the turn completes: apply any block that finished exactly at
    // the end, then do a single camera fit + kick off screen-HTML generation.
    const enqueueTurnScreens = (options: {
      turnId: string
      blocks: readonly ChatBlock[]
      affectedIds: readonly string[]
    }): void => {
      const barrier = ensureReplayBarrier(options.turnId)
      if (!barrier || !onScreenCreatedRef.current) return
      enqueueCanvasTurnScreens({
        ...options,
        document: useCanvasShapeStore.getState().document,
        artifacts: useDesignWorkspaceStore.getState().artifacts,
        chatBlocks: useChatStore.getState().blocks,
        seenIds: screenGenSeen,
        pendingScreens,
        pendingScreenIds: barrier.pendingScreenIds
      })
    }

    const finalizeTurn = (completedTurnId?: string): void => {
      if (trailingTimer) {
        clearTimeout(trailingTimer)
        trailingTimer = null
      }
      const s = useChatStore.getState()
      const userId = activeCanvasUserId(s.blocks)
      if (userId) {
        const text = collectAssistantTextForTurn(s.blocks, userId, s.liveAssistant)
        applyFrom(text, false)
      }
      if (!generatedImageFallbackTarget && userId) {
        captureGeneratedImageFallbackTarget({
          activeThreadId: s.activeThreadId,
          currentTurnId: s.currentTurnId,
          currentTurnUserId: userId,
          blocks: s.blocks
        })
      }
      const turnBlocks = userId
        ? blocksForActiveCanvasTurn({
            activeThreadId: s.activeThreadId,
            currentTurnId: s.currentTurnId,
            currentTurnUserId: userId,
            blocks: s.blocks
          })
        : []
      const userBlock = userId ? s.blocks.find((block) => block.id === userId) : undefined
      const durableTurnBlocks = userBlock ? [userBlock, ...turnBlocks] : turnBlocks
      const replayThreadId = targetThreadId ?? s.activeThreadId
      const placedImages = placeLiveCanvasTurnImages({
        blocks: durableTurnBlocks,
        affectedIds: [...affectedThisTurn],
        threadId: replayThreadId,
        turnId: completedTurnId,
        target: activeDesignTarget,
        fallback: generatedImageFallbackTarget,
        fallbackPlacementTargetId: generatedImagePlacementTargetId,
        placeholderShapeIdForTool: imageGenerationPlaceholderShapeId
      })
      for (const placed of placedImages) affectedThisTurn.add(placed)
      if (placedImages.length > 0) {
        errorsThisTurn.length = 0
      }
      const all = [...affectedThisTurn]
      if (all.length > 0) {
        useCanvasSelectionStore.getState().select(all)
        useDesignAssistantStore.getState().markAiAffected(all)
      }
      // Two-phase design tool receipt: tell the Kun loop whether the renderer
      // applied this turn's canvas operations. The loop finalizes the accepted
      // tool result accordingly (or falls back to `unverified` on timeout).
      if (replayThreadId && completedTurnId) {
        sendCanvasTurnReceipt({
          threadId: replayThreadId,
          turnId: completedTurnId,
          affectedIds: all,
          errors: errorsThisTurn
        })
      }
      // Hand this turn's op errors to the next canvas turn so the agent can fix
      // them. Always set (even []) so a clean turn clears stale errors.
      setLastCanvasOpErrors([...errorsThisTurn], errorKey)
      if (completedTurnId && replayThreadId && (activeDesignTarget || durableReplaySurface)) {
        const barrier = ensureReplayBarrier(completedTurnId)
        if (activeDesignTarget) {
          enqueueTurnScreens({
            turnId: completedTurnId, blocks: durableTurnBlocks, affectedIds: all
          })
        }
        if (barrier) barrier.replayComplete = true
        commitReadyWatermarks()
      }
      resetTurn()
      // Let chat/runtime state settle before starting the follow-up HTML turn.
      scheduleScreenDrain(120)
      scheduleSvgDrain(120)
    }

    const replayIdle = (state: ReturnType<typeof useChatStore.getState>): void => {
      if (!activeDesignTarget) {
        if (durableReplaySurface) replayIdleCodeCanvas({
            state, threadId: targetThreadId, ready: canvasDocumentReady(), errorKey,
            affectedIds: affectedThisTurn, errors: errorsThisTurn, resetTurn, applyToolBlock
          })
        else if (!state.currentTurnId && canvasDocumentReady() &&
          activeCanvasTurnMatchesThread(state, targetThreadId)) {
          replayIdleCanvasToolBlocks(
            state.blocks, applyToolBlock, (block) => void applySvgToolBlock(block)
          )
        }
        return
      }
      replayIdleDesignCanvas({
        state, threadId: targetThreadId, target: activeDesignTarget,
        ready: canvasDocumentReady(), executeOptions, errorKey,
        affectedIds: affectedThisTurn, errors: errorsThisTurn, resetTurn, applyToolBlock,
        onTurnReplayed: (completion, affectedIds) => {
          const barrier = ensureReplayBarrier(completion.turnId)
          enqueueTurnScreens({ turnId: completion.turnId, blocks: completion.blocks, affectedIds })
          if (barrier) barrier.replayComplete = true
          commitReadyWatermarks()
          if (pendingScreens.length > 0) scheduleScreenDrain(0)
          if (pendingSvgToolBlocks.size > 0) scheduleSvgDrain(0)
        }
      })
    }

    // If this hook becomes enabled after a turn has already started (common for
    // the first Code-canvas send, where the thread id appears after sendMessage),
    // catch up with already-present tool blocks/live text before waiting for the
    // next store change.
    const initialState = useChatStore.getState()
    if (initialState.currentTurnId) captureGeneratedImageFallbackTarget(initialState)
    // Do not replay historical tool results into the singleton store until this
    // host owns the expected document; document-sync will replay after it loads.
    if (canvasDocumentReady()) {
      replayActiveCanvasTurn(
        initialState,
        applyToolBlock,
        processStreaming,
        targetThreadId,
        activeDesignTarget,
        unboundTargetPolicy
      )
      materializeActiveGeneratedImages(initialState)
      replayIdle(initialState)
    }

    const unsubscribe = useChatStore.subscribe((state, prev) => {
      if (!activeCanvasTurnMatchesThread(state, targetThreadId)) return
      const turnStarted = !prev.currentTurnId && Boolean(state.currentTurnId)
      const turnEnded = Boolean(prev.currentTurnId) && !state.currentTurnId
      const replayState = canvasReplayStateForStoreUpdate(state, prev)
      if (replayState.currentTurnId &&
        !activeCanvasTurnMatchesDesignTarget(
          replayState,
          activeDesignTarget,
          unboundTargetPolicy
        )) return
      if (!canvasDocumentReady()) return
      if (turnStarted) {
        resetTurn()
        captureGeneratedImageFallbackTarget(state)
      }
      if (replayState.currentTurnId && state.blocks !== prev.blocks) {
        for (const block of blocksForActiveCanvasTurn(replayState)) {
          if (block.kind === 'tool') applyToolBlock(
            block,
            canvasReplayContextForActiveTurn(
              replayState, targetThreadId, activeDesignTarget, `tool:${block.id}`
            ) ?? undefined
          )
        }
        materializeActiveGeneratedImages(replayState)
      }
      if (!state.currentTurnId && state.blocks !== prev.blocks) {
        replayIdle(state)
      }
      if (state.currentTurnId && state.liveAssistant !== prev.liveAssistant) {
        scheduleStreaming()
      }
      if (turnEnded) finalizeTurn(prev.currentTurnId ?? undefined)
      if (
        !state.currentTurnId &&
        !state.busy &&
        !threadHasPendingRuntimeWork(state.blocks) &&
        pendingScreens.length > 0
      ) {
        scheduleScreenDrain(0)
      }
      if (pendingSvgToolBlocks.size > 0) scheduleSvgDrain(0)
    })
    const unsubscribeCanvas = useCanvasShapeStore.subscribe((state, prev) => {
      if (state.documentLoadRevision === prev.documentLoadRevision || !canvasDocumentReady()) return
      appliedToolBlockIds.clear()
      processingSvgToolBlockIds.clear()
      const chatState = useChatStore.getState()
      if (chatState.currentTurnId) {
        replayActiveCanvasTurn(
          chatState,
          applyToolBlock,
          processStreaming,
          targetThreadId,
          activeDesignTarget,
          unboundTargetPolicy
        )
        materializeActiveGeneratedImages(chatState)
      } else replayIdle(chatState)
    })

    return () => {
      disposed = true
      if (trailingTimer) clearTimeout(trailingTimer)
      if (screenDrainTimer) clearTimeout(screenDrainTimer)
      if (svgDrainTimer) clearTimeout(svgDrainTimer)
      unsubscribe()
      unsubscribeCanvas()
    }
  }, [
    enabled,
    executeOptions,
    errorKey,
    targetThreadId,
    onCanvasExportRequested,
    designDocumentTarget?.documentId,
    designDocumentTarget?.boardArtifactId,
    expectedCanvasDocumentKey,
    pptProjectionWorkflowId,
    pptProjectionChildId,
    durableReplaySurface
  ])
}
