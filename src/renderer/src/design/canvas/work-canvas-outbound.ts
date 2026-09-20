import {
  ComposerContextAttachmentSchema,
  ComposerContextReferenceSchema,
  type ComposerContextAttachment,
  type JsonObject
} from '@kun/extension-api'
import {
  defaultFrameSizeForDesignTarget,
  normalizeDesignTarget,
  type DesignContext
} from '../design-context'
import {
  peekLastCanvasOpErrors
} from './apply-shape-ops'
import type {
  CanvasPlacementRect,
  CanvasSnapshot,
  CanvasSnapshotShape
} from './canvas-snapshot'
import type { CanvasDocument, ViewBox } from './canvas-types'
import type { OpError } from './shape-ops'
import { summarizeExcalidrawScene } from '../../whiteboard/excalidraw-outbound'
import {
  excalidrawScenePath
} from '../../whiteboard/excalidraw-persistence'
import {
  resolveWorkCanvasIdentity,
  snapshotWorkCanvasForPrompt
} from './work-canvas'

const MAX_REFERENCE_SHAPES = 64
const MAX_REFERENCE_SHAPES_FOCUSED = 18
const MAX_REFERENCE_SHAPES_NEW_BOARD = 8
const MAX_REFERENCE_POINTS = 2

export type WorkCanvasReferenceIntent = 'default' | 'whole-board' | 'new-board'

export function workCanvasReferenceIntent(text: string): WorkCanvasReferenceIntent {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return 'default'
  const wholeBoard = /(全部|所有|整个|全量|整份|翻译|审查|审阅|导出|总结|translate|review|export|summar)/.test(normalized)
  if (wholeBoard) return 'whole-board'
  const newBoard = /(新建|创建|新架构|画一个|架构图|流程图|草图|create|new|diagram|architecture|sketch)/.test(normalized)
  if (newBoard) return 'new-board'
  return 'default'
}

export type WorkCanvasOutboundDeps = {
  snapshotForPrompt?: typeof snapshotWorkCanvasForPrompt
  takeLastErrors?: (key: string) => OpError[]
  peekLastErrors?: (key: string) => OpError[]
}

export type BuildWorkCanvasReferenceContextOptions = WorkCanvasOutboundDeps & {
  workspaceRoot: string
  boardId: string
  boardRevision: number
  currentDocument: CanvasDocument
  currentDocumentKey?: string | null
  selectedIds: ReadonlySet<string>
  viewBox: ViewBox
  designContext: DesignContext
  intent?: WorkCanvasReferenceIntent
  engine?: 'kun' | 'excalidraw'
  excalidrawScene?: { elements?: unknown[] } | null
}

async function readSnapshot(
  options: BuildWorkCanvasReferenceContextOptions
): Promise<CanvasSnapshot | undefined> {
  const snapshotForPrompt = options.snapshotForPrompt ?? snapshotWorkCanvasForPrompt
  return snapshotForPrompt({
    workspaceRoot: options.workspaceRoot,
    boardId: options.boardId,
    currentDocument: options.currentDocument,
    currentDocumentKey: options.currentDocumentKey,
    selectedIds: options.selectedIds,
    viewBox: options.viewBox,
    defaultScreenSize: defaultFrameSizeForDesignTarget(options.designContext.designTarget)
  })
}

function compactText(value: string, maxChars: number): string {
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0)
      return (code < 32 && code !== 9 && code !== 10) || code === 127 ? ' ' : character
    })
    .join('')
    .trim()
    .slice(0, maxChars)
  const safe = /[\uD800-\uDBFF]$/.test(normalized) ? normalized.slice(0, -1) : normalized
  return /^(?:file:|\/|\\\\|[A-Za-z]:[\\/])/i.test(safe)
    ? `[verbatim reference]\n${safe}`
    : safe
}

function compactRect(rect: CanvasPlacementRect): JsonObject {
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
}

function compactShape(shape: CanvasSnapshotShape): JsonObject {
  const result: JsonObject = {
    id: compactText(shape.id, 128),
    name: compactText(shape.name, 128),
    type: shape.type,
    x: shape.x,
    y: shape.y,
    w: shape.w,
    h: shape.h,
    parentName: shape.parentName === null ? null : compactText(shape.parentName, 128)
  }
  if (shape.rotation !== undefined) result.rotation = shape.rotation
  if (shape.selected) result.selected = true
  if (shape.inView) result.inView = true
  if (shape.nearSelection) result.nearSelection = true
  if (shape.textContent) result.textContent = compactText(shape.textContent, 320)
  if (shape.imageUrl) result.imageUrl = compactText(shape.imageUrl, 360)
  if (shape.fill) result.fill = shape.fill
  if (shape.gradient) result.gradient = compactText(shape.gradient, 160)
  if (shape.stroke) result.stroke = shape.stroke
  if (shape.fontColor) result.fontColor = shape.fontColor
  if (shape.cornerRadius !== undefined) result.cornerRadius = shape.cornerRadius
  if (shape.shadow) result.shadow = compactText(shape.shadow, 160)
  if (shape.layout) result.layout = compactText(shape.layout, 160)
  if (shape.points?.length) {
    const points = shape.points.length <= MAX_REFERENCE_POINTS
      ? shape.points
      : [shape.points[0], shape.points.at(-1)!]
    result.points = points.map((point) => ({ x: point.x, y: point.y }))
  }
  return result
}

function compactSnapshot(
  snapshot: CanvasSnapshot | undefined,
  shapeLimit = MAX_REFERENCE_SHAPES
): JsonObject {
  if (!snapshot) {
    return { shapeCount: 0, includedShapeCount: 0, omittedShapeCount: 0, shapes: [] }
  }
  const shapes = prioritizedReferenceShapes(snapshot.shapes)
    .slice(0, shapeLimit)
    .map(compactShape)
  const placement = snapshot.placement
    ? {
        empty: snapshot.placement.empty,
        ...(snapshot.placement.viewBox
          ? { viewBounds: compactRect(snapshot.placement.viewBox) }
          : {}),
        ...(snapshot.placement.contentBounds
          ? { contentBounds: compactRect(snapshot.placement.contentBounds) }
          : {}),
        ...(snapshot.placement.selectedBounds
          ? { selectedBounds: compactRect(snapshot.placement.selectedBounds) }
          : {}),
        occupiedFrames: snapshot.placement.occupiedFrames.slice(0, 12).map((frame) => ({
          id: compactText(frame.id, 128),
          name: compactText(frame.name, 128),
          ...(frame.regionKind ? { regionKind: frame.regionKind } : {}),
          ...compactRect(frame)
        })),
        defaultFrame: {
          w: snapshot.placement.defaultScreen.w,
          h: snapshot.placement.defaultScreen.h
        },
        recommendedSlots: snapshot.placement.recommendedSlots.slice(0, 3).map((slot) => ({
          label: compactText(slot.label, 128),
          reason: compactText(slot.reason, 240),
          ...compactRect(slot)
        }))
      }
    : undefined
  return {
    shapeCount: snapshot.shapeCount,
    includedShapeCount: shapes.length,
    omittedShapeCount: Math.max(0, snapshot.shapeCount - shapes.length),
    shapes,
    ...(placement ? { placement } : {})
  }
}

function referenceShapePriority(shape: CanvasSnapshotShape): number {
  if (shape.selected) return 0
  if (shape.nearSelection) return 1
  if (shape.inView && shape.textContent) return 2
  if (shape.inView) return 3
  if (shape.textContent) return 4
  return 5
}

function prioritizedReferenceShapes(shapes: readonly CanvasSnapshotShape[]): CanvasSnapshotShape[] {
  return shapes
    .map((shape, index) => ({ shape, index }))
    .sort((left, right) =>
      referenceShapePriority(left.shape) - referenceShapePriority(right.shape) ||
      left.index - right.index
    )
    .map((entry) => entry.shape)
}

function compactErrors(errors: readonly OpError[]): JsonObject[] {
  return errors.slice(0, 8).map((error) => ({
    code: error.code,
    message: compactText(error.message, 320),
    ...(error.suggestion ? { suggestion: compactText(error.suggestion, 320) } : {})
  }))
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function boundedWhiteboardReference(input: {
  boardId: string
  designTarget: string
  snapshot: CanvasSnapshot | undefined
  errors: readonly OpError[]
  shapeLimit?: number
}): JsonObject {
  const start = input.shapeLimit ?? MAX_REFERENCE_SHAPES_FOCUSED
  for (let shapeLimit = start; shapeLimit >= 0; shapeLimit -= 1) {
    const reference: JsonObject = {
      kind: 'work-reference-whiteboard',
      schemaVersion: 1,
      boardId: compactText(input.boardId, 128),
      designTarget: input.designTarget,
      snapshot: compactSnapshot(input.snapshot, shapeLimit),
      ...(input.errors.length ? { previousErrors: compactErrors(input.errors) } : {})
    }
    if (ComposerContextReferenceSchema.safeParse(reference).success) return reference
  }
  throw new Error('The current Work whiteboard reference exceeds the bounded context budget.')
}

/**
 * Captures only volatile Work-board facts as a bounded composer reference. The
 * stable operating rules live in WORK_MODE_INSTRUCTION inside the Kun runtime.
 */
export async function buildWorkCanvasReferenceContext(
  options: BuildWorkCanvasReferenceContextOptions
): Promise<ComposerContextAttachment> {
  const identity = resolveWorkCanvasIdentity(options.workspaceRoot, options.boardId)
  if (options.engine === 'excalidraw') {
    const summary = summarizeExcalidrawScene(options.excalidrawScene)
    const scenePath = excalidrawScenePath(identity.artifactId, identity.baseDir)
    const reference: JsonObject = {
      kind: 'work-reference-whiteboard',
      schemaVersion: 1,
      boardId: compactText(identity.boardId, 128),
      engine: 'excalidraw',
      scenePath: compactText(scenePath, 240),
      elementCount: summary.elementCount,
      elements: summary.elements.map((element) => ({
        type: compactText(element.type, 32),
        ...(element.text ? { text: compactText(element.text, 120) } : {})
      }))
    }
    if (!ComposerContextReferenceSchema.safeParse(reference).success) {
      throw new Error('The current Work Excalidraw reference exceeds the bounded context budget.')
    }
    const workspaceId = await sha256Hex(options.workspaceRoot.trim() || '__default__')
    const referenceId = await sha256Hex(JSON.stringify({ workspaceId, reference }))
    return ComposerContextAttachmentSchema.parse({
      schemaVersion: 1,
      id: `work-whiteboard-${referenceId.slice(0, 24)}`,
      title: 'Current Work whiteboard',
      summary: `Excalidraw sketch · ${summary.elementCount} elements`,
      reference,
      revision: Math.max(0, Math.floor(options.boardRevision)),
      generation: 0,
      attachmentId: `workspace-view-context:${referenceId}`,
      provenance: { source: 'workspace-view', workspaceId }
    })
  }
  const snapshot = await readSnapshot(options)
  const errors = (options.peekLastErrors ?? options.takeLastErrors ?? peekLastCanvasOpErrors)(identity.errorKey)
  const intent = options.intent ?? workCanvasReferenceIntent(options.workspaceRoot)
  const shapeLimit =
    intent === 'whole-board'
      ? MAX_REFERENCE_SHAPES
      : intent === 'new-board'
        ? MAX_REFERENCE_SHAPES_NEW_BOARD
        : MAX_REFERENCE_SHAPES_FOCUSED
  const reference = boundedWhiteboardReference({
    boardId: identity.boardId,
    designTarget: normalizeDesignTarget(options.designContext.designTarget),
    snapshot,
    errors,
    shapeLimit
  })
  const workspaceId = await sha256Hex(options.workspaceRoot.trim() || '__default__')
  const referenceId = await sha256Hex(JSON.stringify({ workspaceId, reference }))
  const selectedCount = snapshot?.shapes.filter((shape) => shape.selected).length ?? 0
  return ComposerContextAttachmentSchema.parse({
    schemaVersion: 1,
    id: `work-whiteboard-${referenceId.slice(0, 24)}`,
    title: 'Current Work whiteboard',
    summary: `${snapshot?.shapeCount ?? 0} shapes · ${selectedCount} selected`,
    reference,
    revision: Math.max(0, Math.floor(options.boardRevision)),
    generation: 0,
    attachmentId: `workspace-view-context:${referenceId}`,
    provenance: { source: 'workspace-view', workspaceId }
  })
}
