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
  applySvgToolBlockWithQueue,
  type SvgArtifactRequestHandler
} from './svg-artifact-tool-replay'
import { drainPendingScreens, drainPendingSvgBlocks, type CanvasTurnDrainContext } from './canvas-turn-drain'
import {
  assembledTurnText as assembledCanvasTurnText,
  applyCanvasStreamFrom,
  materializeActiveGeneratedImages as materializeCanvasGeneratedImages,
  type CanvasTurnStreamingContext
} from './canvas-turn-streaming'
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
  suppressPendingCanvasContinuations,
  type CanvasReplayBarrierState,
  type CanvasScreenCreatedHandler,
  type PendingScreenGeneration,
  type CanvasReplayBarrierCollection
} from './canvas-design-replay-support'
import {
  canvasTurnContinuationDecision,
  type CanvasTurnOutcome
} from './canvas-turn-outcome'
import {
  createCanvasTurnContinuationGate,
  type ContinuationQueues
} from './canvas-turn-continuation-gate'

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
    const replayBarriers: CanvasReplayBarrierCollection = new Map()
    let disposed = false
    // Continuation gate for the most recent ended turn. `unknown` outcomes wait
    // for the authoritative terminal record instead of running follow-ups.
    let turnContinuationGate: ReturnType<typeof createCanvasTurnContinuationGate> | null = null
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

    const suppressContinuations = (): void => {
      suppressPendingCanvasContinuations({
        pendingScreens,
        pendingSvgToolBlocks,
        svgSourceTurnIds,
        svgRetryCounts,
        barriers: replayBarriers
      })
    }

    const captureGeneratedImageFallbackTarget = (state: CanvasTurnReplayState): void => {
      const captured = captureCanvasGeneratedImageFallback(state)
      generatedImageFallbackTarget = captured.fallback
      generatedImagePlacementTargetId = captured.placementTargetId
    }

    const streamingContext = (): CanvasTurnStreamingContext => ({
      activeDesignTarget,
      targetThreadId,
      executeOptions,
      canvasDocumentReady,
      getChatState: () => useChatStore.getState(),
      getSelectionStore: () => useCanvasSelectionStore.getState(),
      getDesignAssistantStore: () => useDesignAssistantStore.getState(),
      affectedThisTurn,
      errorsThisTurn,
      getAppliedCount: () => appliedCount,
      setAppliedCount: (value) => {
        appliedCount = value
      },
      getFramedThisTurn: () => framedThisTurn,
      setFramedThisTurn: (value) => {
        framedThisTurn = value
      },
      applyDurableOpsSince: applyDurableCanvasOpsSince
    })

    const materializeActiveGeneratedImages = (state: CanvasTurnReplayState): void =>
      materializeCanvasGeneratedImages(
        streamingContext(),
        state,
        generatedImageFallbackTarget,
        generatedImagePlacementTargetId
      )

    const processStreaming = (): void => {
      lastRunAt = Date.now()
      if (!canvasDocumentReady() || !useChatStore.getState().currentTurnId) return
      applyCanvasStreamFrom(streamingContext(), assembledCanvasTurnText(streamingContext()), true)
    }

    const applySvgToolBlock = async (
      block: ToolBlock,
      allowLegacy = false,
      sourceTurnId = svgSourceTurnIds.get(block.id) ?? ''
    ): Promise<void> => {
      await applySvgToolBlockWithQueue({
        block,
        allowLegacy,
        sourceTurnId,
        onRequest: onSvgArtifactRequestedRef.current,
        chatState: useChatStore.getState(),
        artifacts: useDesignWorkspaceStore.getState().artifacts,
        appliedBlockIds: appliedToolBlockIds,
        processingBlockIds: processingSvgToolBlockIds,
        pendingBlocks: pendingSvgToolBlocks,
        svgSourceTurnIds,
        retryCounts: svgRetryCounts,
        scheduleDrain: scheduleSvgDrain,
        ensureBarrier: (turnId) => ensureReplayBarrier(turnId),
        commitWatermarks: commitReadyWatermarks,
        onApplied: (shapeIds) => {
          useCanvasSelectionStore.getState().select(shapeIds)
          useDesignAssistantStore.getState().markAiAffected(shapeIds)
          framedThisTurn = true
        }
      })
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

    const drainContext = (): CanvasTurnDrainContext => ({
      pendingScreens,
      pendingSvgToolBlocks,
      svgSourceTurnIds,
      isDisposed: () => disposed,
      getChatState: () => useChatStore.getState(),
      getDocument: () => useCanvasShapeStore.getState().document,
      getHtmlArtifactIds: () => new Set(
        useDesignWorkspaceStore.getState().artifacts
          .filter((artifact) => artifact.kind === 'html')
          .map((artifact) => artifact.id)
      ),
      ensureBarrier: (turnId) => ensureReplayBarrier(turnId),
      commitWatermarks: commitReadyWatermarks,
      selectShape: (shapeId) => useCanvasSelectionStore.getState().select([shapeId]),
      onScreenCreated: (shapeId, userPrompt, brief) => onScreenCreatedRef.current?.(shapeId, userPrompt, brief),
      applySvgToolBlock,
      scheduleScreenDrain,
      scheduleSvgDrain
    })

    function scheduleScreenDrain(delay = 160): void {
      if (screenDrainTimer || turnContinuationGate?.pending()) return
      screenDrainTimer = setTimeout(() => {
        screenDrainTimer = null
        void drainPendingScreens(drainContext())
      }, delay)
    }

    function scheduleSvgDrain(delay = 120): void {
      if (svgDrainTimer || turnContinuationGate?.pending()) return
      svgDrainTimer = setTimeout(() => {
        svgDrainTimer = null
        drainPendingSvgBlocks(drainContext())
      }, delay)
    }

    const continuationQueues = (): ContinuationQueues => ({
      pendingScreens,
      pendingSvgToolBlocks,
      svgSourceTurnIds,
      svgRetryCounts,
      barriers: replayBarriers
    })
    const resolveTurnOutcome = (turnId: string, threadId: string | null): CanvasTurnOutcome =>
      createCanvasTurnContinuationGate({
        turnId,
        threadId,
        getChatState: () => useChatStore.getState(),
        queues: continuationQueues(),
        isDisposed: () => disposed,
        onContinue: () => undefined
      }).outcomeNow()

    // Gate the follow-up work of an ended turn on its terminal outcome. The
    // outcome is re-resolved on every poll, so a terminal record that arrives
    // late still flips the decision before the wait window closes.
    const startTurnContinuation = (
      turnId: string,
      threadId: string | null,
      outcome: CanvasTurnOutcome,
      onContinue: () => void,
      continueOnUnknownTimeout = false
    ): void => {
      if (canvasTurnContinuationDecision(outcome) === 'continue') {
        onContinue()
        return
      }
      turnContinuationGate?.cancel()
      if (canvasTurnContinuationDecision(outcome) === 'stop') {
        turnContinuationGate = null
        suppressContinuations()
        return
      }
      const gate = createCanvasTurnContinuationGate({
        turnId,
        threadId,
        getChatState: () => useChatStore.getState(),
        queues: continuationQueues(),
        isDisposed: () => disposed,
        onContinue,
        onStoppedUnknown: (turnId) => {
          console.warn(`[canvas] turn ${turnId} continuation stopped after unknown outcome timeout`)
        },
        continueOnUnknownTimeout
      })
      turnContinuationGate = gate
      gate.begin()
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

    const finalizeTurn = (
      completedTurnId?: string,
      outcome: CanvasTurnOutcome = 'unknown'
    ): void => {
      if (trailingTimer) {
        clearTimeout(trailingTimer)
        trailingTimer = null
      }
      const s = useChatStore.getState()
      const userId = activeCanvasUserId(s.blocks)
      if (userId) {
        const text = collectAssistantTextForTurn(s.blocks, userId, s.liveAssistant)
        applyCanvasStreamFrom(streamingContext(), text, false)
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
      const capturedAll = [...all]
      const continueTurn = (): void => {
        if (completedTurnId && replayThreadId && (activeDesignTarget || durableReplaySurface)) {
          if (activeDesignTarget) {
            enqueueTurnScreens({
              turnId: completedTurnId, blocks: durableTurnBlocks, affectedIds: capturedAll
            })
          }
          const barrier = ensureReplayBarrier(completedTurnId)
          if (barrier) barrier.replayComplete = true
          commitReadyWatermarks()
        }
        // Let chat/runtime state settle before starting the follow-up HTML turn.
        scheduleScreenDrain(120)
        scheduleSvgDrain(120)
      }
      if (completedTurnId && replayThreadId && (activeDesignTarget || durableReplaySurface)) {
        const barrier = ensureReplayBarrier(completedTurnId)
        if (canvasTurnContinuationDecision(outcome) !== 'continue') {
          if (barrier) barrier.replayComplete = true
          commitReadyWatermarks()
        }
        startTurnContinuation(completedTurnId, replayThreadId, outcome, continueTurn)
      } else if (canvasTurnContinuationDecision(outcome) === 'stop') {
        suppressContinuations()
      }
      resetTurn()
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
          startTurnContinuation(
            completion.turnId,
            targetThreadId ?? state.activeThreadId,
            completion.outcome,
            () => {
              enqueueTurnScreens({
                turnId: completion.turnId, blocks: completion.blocks, affectedIds
              })
              const barrier = ensureReplayBarrier(completion.turnId)
              if (barrier) barrier.replayComplete = true
              commitReadyWatermarks()
              if (pendingScreens.length > 0) scheduleScreenDrain(0)
              if (pendingSvgToolBlocks.size > 0) scheduleSvgDrain(0)
            },
            true
          )
          if (canvasTurnContinuationDecision(completion.outcome) !== 'continue') {
            const barrier = ensureReplayBarrier(completion.turnId)
            if (barrier) barrier.replayComplete = true
            commitReadyWatermarks()
          }
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
        // A new turn supersedes any pending continuation of the previous one.
        turnContinuationGate?.cancel()
        turnContinuationGate = null
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
      if (turnEnded) {
        const completedTurnId = prev.currentTurnId ?? undefined
        finalizeTurn(
          completedTurnId,
          completedTurnId
            ? resolveTurnOutcome(completedTurnId, targetThreadId ?? state.activeThreadId)
            : 'unknown'
        )
      }
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
      turnContinuationGate?.cancel()
      turnContinuationGate = null
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
