import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { requestCodeCanvasPanelOpen } from '../../lib/code-canvas-panel-event'
import { focusViewportOnIds } from './canvas-focus'
import { currentCanvasOccupiedRects } from './canvas-occupied-regions'
import { placeRectInViewportAvoiding } from './canvas-placement'
import { useCanvasShapeStore } from './canvas-shape-store'
import { createDefaultShape } from './canvas-types'
import { generatedImageResultsForTurn } from './canvas-generated-image-replay'
import { useCanvasViewportStore } from './canvas-viewport-store'
import { useDesignSystemBoardLayoutStore } from './design-system-board-layout'

/**
 * Renderer-side visibility for in-flight AI-image generation on a bound Design
 * whiteboard.
 *
 * When a `generate_image`-family tool enters running (pending), the whiteboard
 * creates an `aiImageHolder` placeholder at the recommended slot so the user
 * sees progress immediately and the slot survives reload/replay through
 * `canvas.json`. A successful tool result is placed by the existing live
 * placement machinery and the placeholder is removed; a failure or an aborted
 * turn turns the placeholder into a red error state carrying a retry action.
 *
 * Markers are embedded in the shape `name` (not a new shape field) so older
 * canvas documents, the layer panel, and the AI snapshot keep working, and a
 * remount can re-derive placeholder state from persisted shapes alone.
 */

export type ImageGenerationProgressEntry = {
  toolCallId: string
  shapeId: string
  status: 'generating' | 'failed'
  startedAt: number
  prompt?: string
  error?: string
  elapsedMs?: number
}

type ImageGenerationProgressState = {
  entries: Record<string, ImageGenerationProgressEntry>
  replaceEntries: (entries: Record<string, ImageGenerationProgressEntry>) => void
}

const GENERATING_MARKER = '⚙ 生成中'
const FAILED_MARKER = '⚠ 生成失败'

function isGenerateImageToolName(value: unknown): boolean {
  return typeof value === 'string' && (value === 'generate_image' || value.endsWith('__generate_image'))
}

function placeholderName(toolCallId: string, failed: boolean): string {
  return `${failed ? FAILED_MARKER : GENERATING_MARKER}:${toolCallId}`
}

function toolCallIdFromPlaceholderName(name: string): string | null {
  for (const marker of [GENERATING_MARKER, FAILED_MARKER]) {
    if (name.startsWith(`${marker}:`)) {
      const id = name.slice(marker.length + 1).trim()
      return id || null
    }
  }
  return null
}

function toolPromptFromDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined
  try {
    const parsed = JSON.parse(detail) as { prompt?: unknown }
    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
    return prompt || undefined
  } catch {
    return undefined
  }
}

function nextPlaceholderPosition(): { x: number; y: number } {
  const rect = placeRectInViewportAvoiding(
    { width: 200, height: 140 },
    useCanvasViewportStore.getState().vbox,
    currentCanvasOccupiedRects(),
    32
  )
  return { x: rect.x, y: rect.y }
}

function createPlaceholderShape(toolCallId: string): string {
  const shape = createDefaultShape('rect', 0, 0, 'diagram')
  const position = nextPlaceholderPosition()
  useCanvasShapeStore.getState().addShape(
    {
      ...shape,
      id: `gen_${toolCallId.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      name: placeholderName(toolCallId, false),
      x: position.x,
      y: position.y,
      width: 200,
      height: 140,
      cornerRadius: 12,
      aiImageHolder: true,
      fills: [{ type: 'solid', color: '#eef2ff', opacity: 1 }],
      strokes: [{ color: '#6366f1', opacity: 0.6, width: 1.5, position: 'center' }]
    },
    undefined,
    { skipUndo: true }
  )
  const store = useCanvasShapeStore.getState()
  const placed = Object.values(store.document.objects).find(
    (candidate) => candidate.name === placeholderName(toolCallId, false)
  )
  const placedId = placed?.id ?? shape.id
  focusViewportOnIds([placedId])
  return placedId
}

function rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  )
}

function movePlaceholderOutOfOccupiedRegions(shapeId: string): void {
  const shape = useCanvasShapeStore.getState().document.objects[shapeId]
  if (!shape) return
  const occupied = currentCanvasOccupiedRects(new Set([shapeId]))
  if (!occupied.some((rect) => rectsOverlap(shape, rect))) return
  const placement = placeRectInViewportAvoiding(
    { width: shape.width, height: shape.height },
    useCanvasViewportStore.getState().vbox,
    occupied,
    32
  )
  useCanvasShapeStore.getState().updateShape(shapeId, { x: placement.x, y: placement.y }, true)
}

function markPlaceholderFailed(shapeId: string, toolCallId: string): void {
  useCanvasShapeStore.getState().updateShape(
    shapeId,
    {
      name: placeholderName(toolCallId, true),
      aiImageHolder: false,
      fills: [{ type: 'solid', color: '#fef2f2', opacity: 1 }],
      strokes: [{ color: '#dc2626', opacity: 0.7, width: 1.5, position: 'center' }]
    },
    true
  )
}

/**
 * Reconcile placeholder entries against the live chat tool stream. Returns the
 * entries that changed so the hook can persist and react (auto-open, first
 * fit-to-content) exactly once per transition.
 */
export function reconcileImageGenerationProgress(
  blocks: readonly ChatBlock[]
): { entries: Record<string, ImageGenerationProgressEntry>; opened: boolean; succeeded: boolean } {
  const state = useImageGenerationProgressStore.getState()
  const next: Record<string, ImageGenerationProgressEntry> = {}
  const inFlightToolIds = new Set<string>()
  const resolvedToolIds = new Set<string>()
  let opened = false
  let succeeded = false

  for (const block of blocks) {
    if (block.kind !== 'tool' || !isGenerateImageToolName(block.meta?.toolName)) continue
    const tool = block as ToolBlock
    const id = tool.id
    const previous = state.entries[id]
    if (tool.status === 'success') {
      resolvedToolIds.add(id)
      if (previous) {
        const shape = useCanvasShapeStore.getState().document.objects[previous.shapeId]
        const results = generatedImageResultsForTurn([tool])
        const materializedElsewhere = results.length > 0 && results.every((result) =>
          Object.values(useCanvasShapeStore.getState().document.objects).some((candidate) =>
            candidate.type === 'image' && candidate.imageUrl === result.imageUrl
          )
        )
        if (!shape || (shape.type === 'image' && Boolean(shape.imageUrl))) {
          succeeded = true
        } else if (materializedElsewhere) {
          useCanvasShapeStore.getState().deleteShape(previous.shapeId, { skipUndo: true })
          succeeded = true
        } else {
          // The live Design materializer runs before this progress subscriber
          // and converts the producing placeholder. If the target document is
          // not ready yet, retain the entry and shape so remount replay can
          // still materialize the successful result instead of losing its slot.
          next[id] = previous
        }
      }
      continue
    }
    if (tool.status === 'error') {
      resolvedToolIds.add(id)
      const shapeId = previous?.shapeId ?? ''
      if (shapeId) markPlaceholderFailed(shapeId, id)
      next[id] = {
        toolCallId: id,
        shapeId,
        status: 'failed',
        startedAt: previous?.startedAt ?? Date.now(),
        prompt: previous?.prompt ?? toolPromptFromDetail(tool.detail),
        error: 'image_generation_failed',
        elapsedMs: Date.now() - (previous?.startedAt ?? Date.now())
      }
      continue
    }
    // running/pending: ensure a placeholder exists.
    inFlightToolIds.add(id)
    const shapeId = previous?.shapeId && useCanvasShapeStore.getState().document.objects[previous.shapeId]
      ? previous.shapeId
      : createPlaceholderShape(id)
    movePlaceholderOutOfOccupiedRegions(shapeId)
    if (!previous && !opened) opened = true
    next[id] = {
      toolCallId: id,
      shapeId,
      status: 'generating',
      startedAt: previous?.startedAt ?? Date.now(),
      prompt: previous?.prompt ?? toolPromptFromDetail(tool.detail)
    }
  }

  // Placeholders no longer backed by an in-flight tool (turn aborted, block
  // removed, or a reload with no live stream) become actionable failures.
  for (const [toolCallId, entry] of Object.entries(state.entries)) {
    if (inFlightToolIds.has(toolCallId) || resolvedToolIds.has(toolCallId)) continue
    if (entry.shapeId && useCanvasShapeStore.getState().document.objects[entry.shapeId]) {
      markPlaceholderFailed(entry.shapeId, toolCallId)
    }
    next[toolCallId] = {
      ...entry,
      status: 'failed',
      error: entry.error ?? 'image_generation_interrupted',
      elapsedMs: Date.now() - entry.startedAt
    }
  }

  return { entries: next, opened, succeeded }
}

/** Rebuild entries from persisted placeholder shapes (reload resilience). */
export function imageGenerationEntriesFromShapes(): Record<string, ImageGenerationProgressEntry> {
  const entries: Record<string, ImageGenerationProgressEntry> = {}
  for (const shape of Object.values(useCanvasShapeStore.getState().document.objects)) {
    const toolCallId = toolCallIdFromPlaceholderName(shape.name)
    if (!toolCallId) continue
    const failed = shape.name.startsWith(FAILED_MARKER)
    entries[toolCallId] = {
      toolCallId,
      shapeId: shape.id,
      status: failed ? 'failed' : 'generating',
      startedAt: Date.now(),
      error: failed ? 'image_generation_interrupted' : undefined
    }
  }
  return entries
}

export const useImageGenerationProgressStore = create<ImageGenerationProgressState>((set) => ({
  entries: {},
  replaceEntries: (entries) => set({ entries })
}))

export function imageGenerationPlaceholderShapeId(toolCallId: string): string | null {
  const entry = useImageGenerationProgressStore.getState().entries[toolCallId]
  if (!entry?.shapeId) return null
  return useCanvasShapeStore.getState().document.objects[entry.shapeId]
    ? entry.shapeId
    : null
}

/**
 * Mount inside a whiteboard host (CodeCanvasPanel / DesignCanvas). Watches the
 * chat tool stream for `generate_image` and mirrors its lifecycle as
 * placeholder shapes.
 *
 * `onRetry(prompt)` re-drives a failed placeholder's original brief through
 * the host's design-prompt sender; `onFirstSuccess` fires once per successful
 * generation so the host can fit-to-content exactly once.
 */
export function useCanvasImageGenerationProgress(
  enabled: boolean,
  callbacks?: {
    expectedCanvasDocumentKey?: string
    onRetry?: (prompt: string) => void
    onFirstSuccess?: () => void
  }
): void {
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks
  const expectedCanvasDocumentKey = callbacks?.expectedCanvasDocumentKey
  useEffect(() => {
    if (!enabled) return
    const canvasDocumentReady = (): boolean => (
      !expectedCanvasDocumentKey ||
      useCanvasShapeStore.getState().documentKey === expectedCanvasDocumentKey
    )
    const apply = (): void => {
      if (!canvasDocumentReady()) return
      const result = reconcileImageGenerationProgress(useChatStore.getState().blocks)
      useImageGenerationProgressStore.getState().replaceEntries(result.entries)
      if (result.opened) requestCodeCanvasPanelOpen()
      if (result.succeeded) callbacksRef.current?.onFirstSuccess?.()
    }
    const seedAndApply = (): void => {
      if (!canvasDocumentReady()) return
      useImageGenerationProgressStore.setState({
        entries: imageGenerationEntriesFromShapes()
      })
      apply()
    }
    seedAndApply()
    const unsubscribeChat = useChatStore.subscribe(apply)
    const unsubscribeCanvas = useCanvasShapeStore.subscribe((state, previous) => {
      if (state.documentLoadRevision === previous.documentLoadRevision) return
      seedAndApply()
    })
    const unsubscribeBoardLayout = useDesignSystemBoardLayoutStore.subscribe((state, previous) => {
      if (!expectedCanvasDocumentKey) return
      if (state.rects[expectedCanvasDocumentKey] === previous.rects[expectedCanvasDocumentKey]) return
      apply()
    })
    return () => {
      unsubscribeChat()
      unsubscribeCanvas()
      unsubscribeBoardLayout()
      useImageGenerationProgressStore.setState({ entries: {} })
    }
  }, [enabled, expectedCanvasDocumentKey])
}

/** Failed placeholder entries for a host-rendered retry chip. */
export function failedImageGenerationEntries(): ImageGenerationProgressEntry[] {
  return Object.values(useImageGenerationProgressStore.getState().entries)
    .filter((entry) => entry.status === 'failed')
    .sort((a, b) => a.startedAt - b.startedAt)
}
