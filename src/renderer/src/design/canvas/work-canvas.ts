import type { CanvasDocument, ViewBox } from './canvas-types'
import { canvasDocumentKey, loadCanvasDocument } from './canvas-persistence'
import { snapshotCanvas, type CanvasSnapshot } from './canvas-snapshot'
import {
  workWhiteboardArtifactId,
  workWhiteboardBaseDir
} from '../../write/work-whiteboard'

export type WorkCanvasIdentity = {
  workspaceRoot: string
  boardId: string
  artifactId: string
  baseDir: string
  designSystemBaseDir: string
  documentKey: string
  errorKey: string
}

export type WorkCanvasPromptSnapshotOptions = {
  workspaceRoot: string
  boardId: string
  currentDocument: CanvasDocument
  currentDocumentKey?: string | null
  selectedIds: ReadonlySet<string>
  viewBox: ViewBox
  defaultScreenSize: { width: number; height: number }
  maxShapes?: number
  loadDocument?: typeof loadCanvasDocument
}

export function resolveWorkCanvasIdentity(
  workspaceRoot: string,
  boardId: string
): WorkCanvasIdentity {
  const normalizedBoardId = boardId.trim()
  const artifactId = workWhiteboardArtifactId(normalizedBoardId)
  const baseDir = workWhiteboardBaseDir()
  return {
    workspaceRoot,
    boardId: normalizedBoardId,
    artifactId,
    baseDir,
    designSystemBaseDir: `${baseDir}/${artifactId}`,
    documentKey: canvasDocumentKey(workspaceRoot, artifactId, baseDir),
    errorKey: `work-canvas:${normalizedBoardId}`
  }
}

export function workCanvasPptWorkflowGate(boardId: string, workflowId?: string): string {
  return workflowId?.trim() || `__unbound-work-board__:${boardId.trim()}`
}

/**
 * Reads the active Work board without ever leaking another mounted canvas's
 * singleton store state into the prompt. A persisted fallback keeps background
 * Work threads useful while a different editor resource owns the canvas lease.
 */
export async function snapshotWorkCanvasForPrompt(
  options: WorkCanvasPromptSnapshotOptions
): Promise<CanvasSnapshot | undefined> {
  const identity = resolveWorkCanvasIdentity(options.workspaceRoot, options.boardId)
  const storeMatchesBoard = options.currentDocumentKey === identity.documentKey
  const selectedIds = storeMatchesBoard ? options.selectedIds : new Set<string>()
  const snapshotOptions = (includeViewBox: boolean) => ({
    maxShapes: options.maxShapes ?? 180,
    defaultScreenSize: options.defaultScreenSize,
    projectId: identity.artifactId,
    ...(includeViewBox ? { viewBox: options.viewBox } : {})
  })
  if (storeMatchesBoard) {
    const current = snapshotCanvas(
      options.currentDocument,
      selectedIds,
      snapshotOptions(true)
    )
    if (current.shapeCount > 0) return current
  }

  const loadDocument = options.loadDocument ?? loadCanvasDocument
  const persisted = await loadDocument(
    identity.workspaceRoot,
    identity.artifactId,
    identity.baseDir
  )
  if (!persisted) return undefined
  const snapshot = snapshotCanvas(
    persisted,
    selectedIds,
    snapshotOptions(storeMatchesBoard)
  )
  return snapshot.shapeCount > 0 ? snapshot : undefined
}

type WritableWorkCanvasLease = {
  ownerId: string
  boardId: string
}

let writableLease: WritableWorkCanvasLease | null = null

/**
 * Canvas stores are singleton Zustand stores. This lease prevents two Work
 * editor groups from mounting writable viewports that would persist the same
 * in-memory document into different board paths.
 */
export function claimWritableWorkCanvas(ownerId: string, boardId: string): boolean {
  if (writableLease && writableLease.ownerId !== ownerId) return false
  writableLease = { ownerId, boardId }
  return true
}

export function releaseWritableWorkCanvas(ownerId: string): void {
  if (writableLease?.ownerId === ownerId) writableLease = null
}

export function currentWritableWorkCanvas(): WritableWorkCanvasLease | null {
  return writableLease ? { ...writableLease } : null
}

export function resetWritableWorkCanvasForTests(): void {
  writableLease = null
}

export function workCanvasHasBlockingQaNotes(
  document: CanvasDocument,
  workflowId?: string
): boolean {
  const expectedWorkflowId = workflowId?.trim()
  return Object.values(document.objects).some((shape) => {
    if (shape.agentNote?.severity !== 'error' || shape.agentNote.resolved === true) return false
    const refWorkflowId = shape.pptReviewRef?.workflowId ?? shape.pptDirectionRef?.workflowId
    return !expectedWorkflowId || !refWorkflowId || refWorkflowId === expectedWorkflowId
  })
}

export function workCanvasHasCompletePptReviewProjection(
  document: CanvasDocument,
  workflowId?: string,
  childId?: string
): boolean {
  const expectedWorkflowId = workflowId?.trim()
  const expectedChildId = childId?.trim()
  const shapes = Object.values(document.objects)
  const matchesWorkflow = (candidate?: string): boolean =>
    Boolean(candidate && (!expectedWorkflowId || candidate === expectedWorkflowId))
  if (shapes.some((shape) => matchesWorkflow(shape.pptDirectionRef?.workflowId))) return false

  const reviewShapes = shapes.filter((shape) => matchesWorkflow(shape.pptReviewRef?.workflowId))
  if (reviewShapes.length === 0) return false
  const reviewChildIds = new Set(reviewShapes.flatMap((shape) =>
    shape.pptReviewRef ? [shape.pptReviewRef.childId] : []))
  if (reviewChildIds.size !== 1) return false
  if (expectedChildId && reviewShapes.some((shape) => shape.pptReviewRef?.childId !== expectedChildId)) {
    return false
  }
  const slides = new Map<string, { frame?: typeof reviewShapes[number]; preview?: typeof reviewShapes[number] }>()
  for (const shape of reviewShapes) {
    const ref = shape.pptReviewRef
    if (!ref || ref.role === 'annotation') continue
    const key = `${ref.childId}\0${ref.slideId}`
    const slide = slides.get(key) ?? {}
    if (ref.role === 'slide-frame') slide.frame = shape
    if (ref.role === 'preview-image') slide.preview = shape
    slides.set(key, slide)
  }
  return slides.size > 0 && [...slides.values()].every(({ frame, preview }) =>
    Boolean(frame?.pptReviewRef && preview?.pptReviewRef && preview.type === 'image' &&
      preview.imageUrl?.trim() && frame.pptReviewRef.revision === preview.pptReviewRef.revision))
}

export function workCanvasPptSelectionState(
  document: CanvasDocument,
  selectedIds: ReadonlySet<string>,
  workflowId?: string
): { direction: boolean; slides: boolean } {
  const expectedWorkflowId = workflowId?.trim()
  let direction = false
  let slides = false
  for (const id of selectedIds) {
    const shape = document.objects[id]
    if (!shape) continue
    if (shape.pptDirectionRef &&
      (!expectedWorkflowId || shape.pptDirectionRef.workflowId === expectedWorkflowId)) {
      direction = true
    }
    if (shape.pptReviewRef &&
      (!expectedWorkflowId || shape.pptReviewRef.workflowId === expectedWorkflowId)) {
      slides = true
    }
  }
  return { direction, slides }
}
