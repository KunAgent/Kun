import { useCanvasSelectionStore } from '../canvas-selection-store'
import { useCanvasShapeStore } from '../canvas-shape-store'
import type { CanvasDocument, CanvasShape } from '../canvas-types'
import {
  DEFAULT_MOTION_TRACK_DURATION_MS,
  configureTimeline,
  removeKeyframe,
  removeTimeline,
  removeTrack,
  upsertKeyframe
} from '../../motion/canvas-motion-mutations'
import type {
  CanvasMotionDocument,
  CanvasMotionEasing,
  CanvasMotionProperty,
  CanvasMotionTrack
} from '../../motion/canvas-motion-types'
import {
  MAX_CANVAS_MOTION_DURATION_MS,
  MAX_CANVAS_MOTION_KEYFRAMES,
  MAX_CANVAS_MOTION_KEYFRAMES_PER_TRACK,
  MAX_CANVAS_MOTION_TIMELINES,
  MAX_CANVAS_MOTION_TRACKS
} from '../../motion/canvas-motion-types'
import {
  createEmptyMotionDocument,
  findMotionTrack,
  resolveOwningMotionFrameId
} from '../../motion/model'
import {
  appendDesignOperationJournalEntry
} from '../../graph/design-operation-journal'
import type { DesignOperation, DesignOperationJournalEntry } from '../../graph/design-graph-types'
import {
  MAX_RENDERER_MOTION_OP_ARGUMENT_BYTES,
  MAX_RENDERER_MOTION_OPS_PER_BATCH,
  MotionOpSchema,
  type ExecuteMotionOpsResult,
  type MotionOp,
  type MotionOpError
} from './schema'

export type ExecuteMotionOpsOptions = {
  /** Durable ToolBlock id used to make SSE/remount replay idempotent. */
  replayKey?: string
}

const DEFAULT_EASING: CanvasMotionEasing = { type: 'ease-out' }
let motionOperationCounter = 0

function operationId(): string {
  motionOperationCounter += 1
  return `motion_op_${Date.now().toString(36)}_${motionOperationCounter.toString(36)}`
}

function encodedByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function motionCounts(motion: CanvasMotionDocument): {
  timelines: number
  tracks: number
  keyframes: number
} {
  const timelines = Object.values(motion.timelines)
  return {
    timelines: timelines.length,
    tracks: timelines.reduce((sum, timeline) => sum + timeline.tracks.length, 0),
    keyframes: timelines.reduce(
      (sum, timeline) => sum + timeline.tracks.reduce((trackSum, track) => trackSum + track.keyframes.length, 0),
      0
    )
  }
}

function availableTargetSuggestion(document: CanvasDocument, frameId: string): string {
  const targets = Object.values(document.objects)
    .filter((shape): shape is CanvasShape => Boolean(shape))
    .filter((shape) => shape.id !== document.rootId)
    .filter((shape) => resolveOwningMotionFrameId(document, shape.id) === frameId)
    .slice(0, 8)
    .map((shape) => `${shape.name} (${shape.id})`)
  return targets.length > 0
    ? `Use a target from the current snapshot in frame ${frameId}: ${targets.join(', ')}.`
    : `Frame ${frameId} has no eligible layer targets in the current snapshot.`
}

function validateFrame(document: CanvasDocument, frameId: string): MotionOpError | null {
  const frame = document.objects[frameId]
  if (!frame || (frameId !== document.rootId && frame.type !== 'frame')) {
    const frames = Object.values(document.objects)
      .filter((shape): shape is CanvasShape => Boolean(shape) && shape.type === 'frame')
      .slice(0, 8)
      .map((shape) => `${shape.name} (${shape.id})`)
    return {
      code: 'MOTION_FRAME_NOT_FOUND',
      message: `Motion frame ${frameId} does not exist or is not a frame.`,
      suggestion: `Use the canvas root (${document.rootId}) or a current frame id${frames.length ? `: ${frames.join(', ')}` : '.'}`
    }
  }
  return null
}

function validateTarget(
  document: CanvasDocument,
  frameId: string,
  targetShapeId: string
): MotionOpError | null {
  const target = document.objects[targetShapeId]
  if (!target || targetShapeId === document.rootId) {
    return {
      code: 'MOTION_TARGET_NOT_FOUND',
      message: `Motion target ${targetShapeId} does not exist or cannot be animated.`,
      suggestion: availableTargetSuggestion(document, frameId)
    }
  }
  const owningFrameId = resolveOwningMotionFrameId(document, targetShapeId)
  if (owningFrameId !== frameId) {
    return {
      code: 'MOTION_FRAME_SCOPE',
      message: `Motion target ${targetShapeId} belongs to frame ${owningFrameId}, not ${frameId}.`,
      suggestion: `Use frameId ${owningFrameId}, or choose a layer owned by ${frameId}.`
    }
  }
  return null
}

function findTrackForDelete(
  motion: CanvasMotionDocument,
  op: Extract<MotionOp, { op: 'delete' }>
): CanvasMotionTrack | undefined {
  const timeline = motion.timelines[op.frameId]
  if (!timeline) return undefined
  if (op.trackId) return timeline.tracks.find((track) => track.id === op.trackId)
  return timeline.tracks.find((track) =>
    op.targetShapeId && op.property &&
    track.targetShapeId === op.targetShapeId && track.property === op.property
  )
}

function baseValueForShape(shape: CanvasShape, property: CanvasMotionProperty): number {
  if (property === 'scaleX' || property === 'scaleY') return 1
  return shape[property]
}

function mergedKeyframeCount(
  track: CanvasMotionTrack | undefined,
  keyframes: Extract<MotionOp, { op: 'upsert-keyframes' }>['keyframes']
): number {
  const current = (track?.keyframes ?? []).map((keyframe) => ({ id: keyframe.id, timeMs: keyframe.timeMs }))
  for (const keyframe of keyframes) {
    const index = current.findIndex((candidate) =>
      (keyframe.id && candidate.id === keyframe.id) || candidate.timeMs === keyframe.timeMs
    )
    const identity = { id: keyframe.id ?? `time:${keyframe.timeMs}`, timeMs: keyframe.timeMs }
    if (index >= 0) current[index] = identity
    else current.push(identity)
  }
  return current.length
}

function ensureUpsertBudget(
  motion: CanvasMotionDocument,
  op: Extract<MotionOp, { op: 'upsert-keyframes' }>
): MotionOpError | null {
  const timeline = motion.timelines[op.frameId]
  const track = findMotionTrack(timeline, op.targetShapeId, op.property)
  const counts = motionCounts(motion)
  const nextTrackKeyframes = mergedKeyframeCount(track, op.keyframes)
  const nextTrackCount = counts.tracks + (track ? 0 : 1)
  const nextTimelineCount = counts.timelines + (timeline ? 0 : 1)
  const nextKeyframeCount = counts.keyframes - (track?.keyframes.length ?? 0) + nextTrackKeyframes
  if (nextTrackKeyframes > MAX_CANVAS_MOTION_KEYFRAMES_PER_TRACK) {
    return {
      code: 'MOTION_LIMIT_EXCEEDED',
      message: `Track ${track?.id ?? `${op.targetShapeId}/${op.property}`} would exceed ${MAX_CANVAS_MOTION_KEYFRAMES_PER_TRACK} keyframes.`,
      suggestion: 'Delete or update existing keyframes instead of appending more.'
    }
  }
  if (
    nextTimelineCount > MAX_CANVAS_MOTION_TIMELINES ||
    nextTrackCount > MAX_CANVAS_MOTION_TRACKS ||
    nextKeyframeCount > MAX_CANVAS_MOTION_KEYFRAMES
  ) {
    return {
      code: 'MOTION_LIMIT_EXCEEDED',
      message: `Motion document limit exceeded (${nextTimelineCount} timelines, ${nextTrackCount} tracks, ${nextKeyframeCount} keyframes).`,
      suggestion: 'Remove unused motion tracks or split the design into a smaller document.'
    }
  }
  const delayMs = op.delayMs ?? track?.delayMs ?? 0
  const spanMs = Math.max(
    op.spanMs ?? track?.durationMs ?? DEFAULT_MOTION_TRACK_DURATION_MS,
    ...op.keyframes.map((keyframe) => keyframe.timeMs)
  )
  if (delayMs + spanMs > MAX_CANVAS_MOTION_DURATION_MS) {
    return {
      code: 'MOTION_LIMIT_EXCEEDED',
      message: `Track end time ${delayMs + spanMs}ms exceeds ${MAX_CANVAS_MOTION_DURATION_MS}ms.`,
      suggestion: 'Reduce delayMs or spanMs.'
    }
  }
  return null
}

function applyUpsertKeyframes(
  motion: CanvasMotionDocument,
  document: CanvasDocument,
  op: Extract<MotionOp, { op: 'upsert-keyframes' }>
): CanvasMotionDocument {
  const shape = document.objects[op.targetShapeId]!
  let next = motion
  const existing = findMotionTrack(next.timelines[op.frameId], op.targetShapeId, op.property)
  const baseValue = baseValueForShape(shape, op.property)
  for (const keyframe of op.keyframes) {
    const existingKeyframe = existing?.keyframes.find((candidate) =>
      keyframe.id ? candidate.id === keyframe.id : candidate.timeMs === keyframe.timeMs
    )
    next = upsertKeyframe(next, {
      frameId: op.frameId,
      targetShapeId: op.targetShapeId,
      property: op.property,
      trackId: existing?.id,
      keyframeId: keyframe.id,
      timeMs: keyframe.timeMs,
      value: keyframe.value,
      easing: keyframe.easing ?? existingKeyframe?.easing,
      operation: op.operation ?? existing?.operation,
      baseValue,
      delayMs: op.delayMs,
      durationMs: op.spanMs
    })
  }
  return next
}

function paintOrderedTargets(document: CanvasDocument, ids: readonly string[]): string[] {
  const selected = new Set(ids)
  const result: string[] = []
  const seen = new Set<string>()
  const visit = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    if (selected.has(id)) result.push(id)
    for (const childId of document.objects[id]?.children ?? []) visit(childId)
  }
  visit(document.rootId)
  for (const id of [...selected].sort()) visit(id)
  return result
}

type PresetTrackSpec = {
  property: CanvasMotionProperty
  operation: 'set' | 'offset' | 'scale'
  baseValue: number
  from: number
  to: number
}

function presetTrackSpecs(
  shape: CanvasShape,
  op: Extract<MotionOp, { op: 'apply-preset' }>
): PresetTrackSpec[] {
  const reverse = (from: number, to: number): [number, number] =>
    op.direction === 'out' ? [to, from] : [from, to]
  switch (op.preset) {
    case 'fade': {
      const [from, to] = reverse(0, shape.opacity)
      return [{ property: 'opacity', operation: 'set', baseValue: shape.opacity, from, to }]
    }
    case 'move': {
      const x = op.distanceX
      const y = op.distanceY
      const specs: PresetTrackSpec[] = []
      if (x !== undefined) {
        const [from, to] = reverse(x, 0)
        specs.push({ property: 'x', operation: 'offset', baseValue: shape.x, from, to })
      }
      if (y !== undefined || x === undefined) {
        const [from, to] = reverse(y ?? -32, 0)
        specs.push({ property: 'y', operation: 'offset', baseValue: shape.y, from, to })
      }
      return specs
    }
    case 'scale': {
      const [from, to] = reverse(op.scaleFrom ?? 0.8, op.scaleTo ?? 1)
      return [
        { property: 'scaleX', operation: 'scale', baseValue: 1, from, to },
        { property: 'scaleY', operation: 'scale', baseValue: 1, from, to }
      ]
    }
    case 'rotate': {
      const [from, to] = reverse(op.degrees ?? -15, 0)
      return [{ property: 'rotation', operation: 'offset', baseValue: shape.rotation, from, to }]
    }
  }
}

function applyPreset(
  motion: CanvasMotionDocument,
  document: CanvasDocument,
  op: Extract<MotionOp, { op: 'apply-preset' }>
): { motion: CanvasMotionDocument; error?: MotionOpError } {
  const targets = paintOrderedTargets(document, op.targetShapeIds)
  const durationMs = op.durationMs ?? DEFAULT_MOTION_TRACK_DURATION_MS
  const delayMs = op.delayMs ?? 0
  const staggerMs = op.staggerMs ?? 0
  const lastEnd = delayMs + Math.max(0, targets.length - 1) * staggerMs + durationMs
  if (lastEnd > MAX_CANVAS_MOTION_DURATION_MS) {
    return {
      motion,
      error: {
        code: 'MOTION_LIMIT_EXCEEDED',
        message: `Preset end time ${lastEnd}ms exceeds ${MAX_CANVAS_MOTION_DURATION_MS}ms.`,
        suggestion: 'Reduce durationMs, delayMs, staggerMs, or the number of targets.'
      }
    }
  }
  let next = motion
  for (let index = 0; index < targets.length; index += 1) {
    const targetShapeId = targets[index]
    const shape = document.objects[targetShapeId]!
    for (const spec of presetTrackSpecs(shape, op)) {
      const syntheticOp: Extract<MotionOp, { op: 'upsert-keyframes' }> = {
        op: 'upsert-keyframes',
        frameId: op.frameId,
        targetShapeId,
        property: spec.property,
        operation: spec.operation,
        baseValue: spec.baseValue,
        delayMs: delayMs + index * staggerMs,
        spanMs: durationMs,
        keyframes: [
          { timeMs: 0, value: spec.from, easing: op.easing ?? DEFAULT_EASING },
          { timeMs: durationMs, value: spec.to, easing: op.easing ?? DEFAULT_EASING }
        ]
      }
      const budgetError = ensureUpsertBudget(next, syntheticOp)
      if (budgetError) return { motion, error: budgetError }
      next = applyUpsertKeyframes(next, document, syntheticOp)
    }
  }
  return { motion: next }
}

function operationTargets(op: MotionOp): string[] {
  switch (op.op) {
    case 'set-timeline':
      return [op.frameId]
    case 'upsert-keyframes':
      return [op.frameId, op.targetShapeId]
    case 'apply-preset':
      return [op.frameId, ...op.targetShapeIds]
    case 'delete':
      return [op.frameId, ...(op.targetShapeId ? [op.targetShapeId] : [])]
  }
}

function designOperation(
  op: MotionOp,
  label: string,
  replayKey: string | undefined
): DesignOperation {
  return {
    id: operationId(),
    type: 'update_motion',
    label,
    source: 'agent',
    createdAt: new Date().toISOString(),
    targetIds: operationTargets(op),
    payload: replayKey ? { motionOp: op, rendererReplayKey: replayKey } : op
  }
}

function journalForReplayKey(
  document: CanvasDocument,
  replayKey: string | undefined
): DesignOperationJournalEntry | undefined {
  if (!replayKey) return undefined
  return document.operationJournal?.find((entry) => entry.operations.some((operation) => {
    if (operation.type !== 'update_motion' || !operation.payload || typeof operation.payload !== 'object') return false
    return (operation.payload as { rendererReplayKey?: unknown }).rendererReplayKey === replayKey
  }))
}

function resultFromReplayedJournal(entry: DesignOperationJournalEntry): ExecuteMotionOpsResult {
  return {
    ok: entry.status === 'applied',
    affectedIds: [...entry.affectedIds],
    errors: entry.errors.map((error) => ({
      code: error.code as MotionOpError['code'],
      message: error.message,
      ...(error.suggestion ? { suggestion: error.suggestion } : {})
    })),
    replayed: true
  }
}

function executeOne(
  motion: CanvasMotionDocument,
  document: CanvasDocument,
  op: MotionOp
): { motion: CanvasMotionDocument; affectedIds: string[]; error?: MotionOpError } {
  const frameError = validateFrame(document, op.frameId)
  if (frameError) return { motion, affectedIds: [], error: frameError }

  if (op.op === 'set-timeline') {
    return {
      motion: configureTimeline(motion, op.frameId, {
        durationMs: op.durationMs,
        playback: op.playback
      }),
      affectedIds: [op.frameId]
    }
  }

  if (op.op === 'upsert-keyframes') {
    const targetError = validateTarget(document, op.frameId, op.targetShapeId)
    if (targetError) return { motion, affectedIds: [], error: targetError }
    const budgetError = ensureUpsertBudget(motion, op)
    if (budgetError) return { motion, affectedIds: [], error: budgetError }
    return {
      motion: applyUpsertKeyframes(motion, document, op),
      affectedIds: [op.targetShapeId]
    }
  }

  if (op.op === 'apply-preset') {
    for (const targetShapeId of op.targetShapeIds) {
      const targetError = validateTarget(document, op.frameId, targetShapeId)
      if (targetError) return { motion, affectedIds: [], error: targetError }
    }
    const result = applyPreset(motion, document, op)
    return {
      motion: result.motion,
      affectedIds: result.error ? [] : [...op.targetShapeIds],
      ...(result.error ? { error: result.error } : {})
    }
  }

  if (op.kind === 'timeline') {
    return { motion: removeTimeline(motion, op.frameId), affectedIds: [op.frameId] }
  }
  const track = findTrackForDelete(motion, op)
  if (!track) {
    // Deleting a missing track/keyframe is intentionally idempotent.
    return { motion, affectedIds: [op.frameId] }
  }
  if (op.kind === 'track') {
    return {
      motion: removeTrack(motion, op.frameId, track.id),
      affectedIds: [track.targetShapeId]
    }
  }
  const keyframe = op.keyframeId
    ? track.keyframes.find((candidate) => candidate.id === op.keyframeId)
    : track.keyframes.find((candidate) => candidate.timeMs === op.timeMs)
  if (!keyframe) return { motion, affectedIds: [track.targetShapeId] }
  return {
    motion: removeKeyframe(motion, op.frameId, track.id, keyframe.id),
    affectedIds: [track.targetShapeId]
  }
}

/**
 * Validate and apply one renderer Motion tool block. A block is committed as one
 * immutable motion-document replacement, so undo/redo and persistence observe
 * the same canonical mutation as the manual Motion UI.
 */
export function executeMotionOps(
  rawOps: unknown[],
  label = 'motion-ops',
  options: ExecuteMotionOpsOptions = {}
): ExecuteMotionOpsResult {
  const store = useCanvasShapeStore.getState()
  const replayed = journalForReplayKey(store.document, options.replayKey)
  if (replayed) return resultFromReplayedJournal(replayed)

  if (!Array.isArray(rawOps) || rawOps.length > MAX_RENDERER_MOTION_OPS_PER_BATCH) {
    return {
      ok: false,
      affectedIds: [],
      errors: [{
        code: 'MOTION_BATCH_LIMIT',
        message: `motionOps accepts at most ${MAX_RENDERER_MOTION_OPS_PER_BATCH} operations per tool block.`,
        suggestion: 'Split the request into bounded logical Motion edits.'
      }]
    }
  }
  if (rawOps.length === 0) {
    return {
      ok: false,
      affectedIds: [],
      errors: [{
        code: 'INVALID_MOTION_OP',
        message: 'Motion tool output did not contain any motionOps.',
        suggestion: 'Return one bounded semantic Motion operation in the motionOps array.'
      }]
    }
  }
  if (encodedByteLength(rawOps) > MAX_RENDERER_MOTION_OP_ARGUMENT_BYTES) {
    return {
      ok: false,
      affectedIds: [],
      errors: [{
        code: 'MOTION_BATCH_LIMIT',
        message: `motionOps exceeds the ${MAX_RENDERER_MOTION_OP_ARGUMENT_BYTES}-byte renderer limit.`,
        suggestion: 'Send fewer targets or keyframes in this tool call.'
      }]
    }
  }

  const errors: MotionOpError[] = []
  const validatedOps: MotionOp[] = []
  for (let index = 0; index < rawOps.length; index += 1) {
    const parsed = MotionOpSchema.safeParse(rawOps[index])
    if (!parsed.success) {
      errors.push({
        code: 'INVALID_MOTION_OP',
        message: `Motion op #${index}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`
      })
      continue
    }
    validatedOps.push(parsed.data)
  }
  if (validatedOps.length === 0) return { ok: errors.length === 0, affectedIds: [], errors }

  const document = store.document
  let motion = document.motion ?? createEmptyMotionDocument()
  const affectedIds = new Set<string>()
  const appliedOps: MotionOp[] = []
  for (const op of validatedOps) {
    const result = executeOne(motion, document, op)
    if (result.error) {
      errors.push(result.error)
      continue
    }
    motion = result.motion
    appliedOps.push(op)
    for (const id of result.affectedIds) affectedIds.add(id)
  }

  if (appliedOps.length > 0) {
    const selectionBefore = [...useCanvasSelectionStore.getState().selectedIds]
    useCanvasShapeStore.getState().setMotionDocument(motion, label, selectionBefore)
  }

  const journalEntry = appendDesignOperationJournalEntry({
    label,
    status: errors.length === 0 ? 'applied' : 'partial',
    // Keep rejected-but-schema-valid operations in the journal as attempted
    // operations. Besides making partial failures actionable, this persists the
    // replay key even when every target in the tool block was stale.
    operations: validatedOps.map((op) => designOperation(op, label, options.replayKey)),
    affectedIds: [...affectedIds],
    errors: errors.map((error) => ({ ...error }))
  })
  useCanvasShapeStore.getState().appendOperationJournalEntry(journalEntry)

  return {
    ok: errors.length === 0,
    affectedIds: [...affectedIds],
    errors
  }
}
