import type { ChatBlock } from '../../agent/types'
import type { CanvasTurnReplayState } from './canvas-design-turn-replay'
import { isHtmlFrame, isImplicitImageSlot, type CanvasDocument } from './canvas-types'
import type { DesignArtifact } from '../design-types'
import { takeScreenBrief } from './screen-artifact-bridge'
import { useCanvasSelectionStore } from './canvas-selection-store'
import { useCanvasShapeStore } from './canvas-shape-store'
import {
  designImagePlacementTargetFromUserBlock,
  placeGeneratedImagesForTurn,
  type CanvasDesignDocumentTarget,
  type CanvasGeneratedImagePlacementTarget
} from './canvas-design-turn-replay'
import {
  resolveGeneratedImageFallbackTarget,
  type GeneratedImageFallbackTarget
} from './canvas-generated-image-replay'

export type PendingScreenGeneration = {
  shapeId: string
  userPrompt: string
  sourceTurnId?: string
  brief?: string
  attempts?: number
}

export type CanvasScreenCreatedHandler = (
  shapeId: string,
  userPrompt: string,
  brief?: string
) => boolean | void | Promise<boolean | void>

export type CanvasReplayBarrierState = {
  pendingScreenIds: Set<string>
  pendingSvgBlockIds: Set<string>
  replayComplete: boolean
}

export function commitReadyCanvasReplayBarriers(
  barriers: Map<string, CanvasReplayBarrierState>,
  commit: (turnId: string) => void
): void {
  for (const [turnId, barrier] of barriers) {
    if (
      !barrier.replayComplete ||
      barrier.pendingScreenIds.size > 0 ||
      barrier.pendingSvgBlockIds.size > 0
    ) break
    commit(turnId)
    barriers.delete(turnId)
  }
}

export function ensureCanvasReplayBarrier(
  barriers: Map<string, CanvasReplayBarrierState>,
  turnId: string
): CanvasReplayBarrierState | null {
  const normalized = turnId.trim()
  if (!normalized) return null
  const existing = barriers.get(normalized)
  if (existing) return existing
  const created: CanvasReplayBarrierState = {
    pendingScreenIds: new Set(), pendingSvgBlockIds: new Set(), replayComplete: false
  }
  barriers.set(normalized, created)
  return created
}

export function recordReadyCanvasReplayWatermarks(options: {
  disposed: boolean
  barriers: Map<string, CanvasReplayBarrierState>
  record: (turnId: string) => void
}): void {
  if (!options.disposed) commitReadyCanvasReplayBarriers(options.barriers, options.record)
}

export type CanvasReplayBarrierCollection = Map<string, CanvasReplayBarrierState>

export function suppressPendingCanvasContinuations<T>(options: {
  pendingScreens: PendingScreenGeneration[]
  pendingSvgToolBlocks: Map<string, T>
  svgSourceTurnIds: Map<string, string>
  svgRetryCounts: Map<string, number>
  barriers: Map<string, CanvasReplayBarrierState>
}): void {
  options.pendingScreens.length = 0
  options.pendingSvgToolBlocks.clear()
  options.svgSourceTurnIds.clear()
  options.svgRetryCounts.clear()
  for (const barrier of options.barriers.values()) {
    barrier.pendingScreenIds.clear()
    barrier.pendingSvgBlockIds.clear()
    barrier.replayComplete = true
  }
}

export function activeCanvasUserId(blocks: readonly ChatBlock[]): string | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index].kind === 'user') return blocks[index].id
  }
  return null
}

export function scheduleRetryableSvgFailure(options: {
  blockId: string
  retryCounts: Map<string, number>
  retry: () => void
}): void {
  const retries = (options.retryCounts.get(options.blockId) ?? 0) + 1
  options.retryCounts.set(options.blockId, retries)
  if (retries < 2) options.retry()
}

export function markFailedSvgForRetry<T>(options: {
  blockId: string
  block: T
  retryCounts: Map<string, number>
  pendingBlocks: Map<string, T>
  schedule: () => void
}): void {
  scheduleRetryableSvgFailure({
    blockId: options.blockId,
    retryCounts: options.retryCounts,
    retry: () => {
      options.pendingBlocks.set(options.blockId, options.block)
      options.schedule()
    }
  })
}

export function hasDispatchedScreenFollowup(
  blocks: readonly ChatBlock[],
  artifactRelativePath: string,
  sourceTurnId?: string
): boolean {
  const path = artifactRelativePath.trim()
  if (!path) return false
  const sourceIndex = sourceTurnId
    ? blocks.findIndex((block) =>
        block.kind === 'user' && (block.turnId === sourceTurnId || block.id === sourceTurnId)
      )
    : -1
  return blocks.slice(sourceIndex + 1).some((block) =>
    block.kind === 'user' && block.text.includes(`Reserved artifact file: ${path}`)
  )
}

export function takeNextReadyScreenGeneration({
  pendingScreens,
  document,
  currentTurnId,
  busy = false,
  pendingRuntimeWork = false,
  htmlArtifactIds,
  onDrop
}: {
  pendingScreens: PendingScreenGeneration[]
  document: CanvasDocument
  currentTurnId: string | null
  busy?: boolean
  pendingRuntimeWork?: boolean
  htmlArtifactIds?: ReadonlySet<string>
  onDrop?: (pending: PendingScreenGeneration) => void
}): PendingScreenGeneration | null {
  if (currentTurnId || busy || pendingRuntimeWork) return null
  while (pendingScreens.length > 0) {
    const next = pendingScreens.shift()
    if (!next) continue
    const shape = document.objects[next.shapeId]
    if (
      !shape ||
      !isHtmlFrame(shape) ||
      !shape.htmlArtifactId ||
      (htmlArtifactIds && !htmlArtifactIds.has(shape.htmlArtifactId))
    ) {
      onDrop?.(next)
      continue
    }
    return next
  }
  return null
}

export async function dispatchNextPendingScreen(options: {
  pendingScreens: PendingScreenGeneration[]
  document: CanvasDocument
  currentTurnId: string | null
  busy: boolean
  pendingRuntimeWork: boolean
  htmlArtifactIds: ReadonlySet<string>
  onDrop: (pending: PendingScreenGeneration) => void
  onDispatch: (pending: PendingScreenGeneration) => boolean | void | Promise<boolean | void>
}): Promise<{ status: 'empty' | 'blocked' | 'failed' | 'dispatched'; pending?: PendingScreenGeneration }> {
  const next = takeNextReadyScreenGeneration(options)
  if (!next) {
    return {
      status: options.pendingScreens.length > 0 ? 'blocked' : 'empty'
    }
  }
  try {
    const dispatched = (await options.onDispatch(next)) !== false
    if (dispatched) return { status: 'dispatched', pending: next }
  } catch {
    // Failed dispatches stay retryable in this mount and after durable replay.
  }
  options.pendingScreens.unshift(next)
  next.attempts = (next.attempts ?? 0) + 1
  return { status: 'failed', pending: next }
}

export function userTextForCanvasFallback(block: ChatBlock | null | undefined): string {
  if (!block || block.kind !== 'user') return ''
  const displayText = block.meta?.displayText
  return typeof displayText === 'string' && displayText.trim() ? displayText : block.text
}

export function userBlockForActiveCanvasTurn(
  state: CanvasTurnReplayState
): Extract<ChatBlock, { kind: 'user' }> | null {
  if (state.currentTurnUserId) {
    const block = state.blocks.find((candidate) =>
      candidate.kind === 'user' && candidate.id === state.currentTurnUserId
    )
    if (block?.kind === 'user') return block
  }
  for (let index = state.blocks.length - 1; index >= 0; index -= 1) {
    const block = state.blocks[index]
    if (block.kind === 'user') return block
  }
  return null
}

export function enqueueCanvasTurnScreens(options: {
  turnId: string
  blocks: readonly ChatBlock[]
  affectedIds: readonly string[]
  document: CanvasDocument
  artifacts: readonly DesignArtifact[]
  chatBlocks: readonly ChatBlock[]
  seenIds: Set<string>
  pendingScreens: PendingScreenGeneration[]
  pendingScreenIds: Set<string>
}): void {
  const sourceUser = options.blocks.find((block) => block.kind === 'user')
  const userPrompt = sourceUser?.kind === 'user' ? sourceUser.text ?? '' : ''
  for (const id of options.affectedIds) {
    const shape = options.document.objects[id]
    if (!shape || !isHtmlFrame(shape) || options.seenIds.has(id)) continue
    options.seenIds.add(id)
    const artifact = options.artifacts.find((item) =>
      item.kind === 'html' && item.id === shape.htmlArtifactId
    )
    if (
      artifact?.previewStatus === 'ready' ||
      (artifact && hasDispatchedScreenFollowup(
        options.chatBlocks, artifact.relativePath, options.turnId
      ))
    ) continue
    options.pendingScreenIds.add(id)
    const brief = takeScreenBrief(id)
    options.pendingScreens.push({
      shapeId: id,
      userPrompt,
      sourceTurnId: options.turnId,
      ...(brief ? { brief } : {})
    })
  }
}

export function captureCanvasGeneratedImageFallback(
  state: CanvasTurnReplayState
): { fallback: GeneratedImageFallbackTarget | null; placementTargetId: string | null } {
  const userBlock = userBlockForActiveCanvasTurn(state)
  const fallback = resolveGeneratedImageFallbackTarget({
    document: useCanvasShapeStore.getState().document,
    selectedIds: useCanvasSelectionStore.getState().selectedIds,
    userText: userTextForCanvasFallback(userBlock)
  })
  const selectedIds = useCanvasSelectionStore.getState().selectedIds
  if (selectedIds.size !== 1) return { fallback, placementTargetId: null }
  const [selectedId] = [...selectedIds]
  const selected = useCanvasShapeStore.getState().document.objects[selectedId]
  return {
    fallback,
    placementTargetId: selected && (selected.aiImageHolder || isImplicitImageSlot(selected))
      ? selected.id
      : null
  }
}

export function placeLiveCanvasTurnImages(options: {
  blocks: readonly ChatBlock[]
  affectedIds: readonly string[]
  threadId?: string | null
  turnId?: string
  target?: CanvasDesignDocumentTarget
  fallback: GeneratedImageFallbackTarget | null
  fallbackPlacementTargetId: string | null
  placeholderShapeIdForTool?: (toolBlockId: string) => string | null
}): string[] {
  const user = options.blocks.find((block) => block.kind === 'user')
  const placementTarget: CanvasGeneratedImagePlacementTarget | undefined =
    designImagePlacementTargetFromUserBlock(user) ??
    (options.fallback
      ? { id: options.fallback.id, expectedImageUrl: options.fallback.imageUrl }
      : options.fallbackPlacementTargetId
        ? { id: options.fallbackPlacementTargetId }
        : undefined)
  return placeGeneratedImagesForTurn({
    blocks: options.blocks,
    affectedIds: options.affectedIds,
    ...(options.threadId ? { threadId: options.threadId } : {}),
    ...(options.turnId ? { turnId: options.turnId } : {}),
    ...(options.target ? { target: options.target } : {}),
    ...(placementTarget ? { placementTarget } : {}),
    ...(options.placeholderShapeIdForTool
      ? { placeholderShapeIdForTool: options.placeholderShapeIdForTool }
      : {})
  })
}
