import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasDocumentKey } from './canvas-persistence'
import { createDefaultShape, createEmptyDocument } from './canvas-types'
import {
  claimWritableWorkCanvas,
  currentWritableWorkCanvas,
  releaseWritableWorkCanvas,
  resetWritableWorkCanvasForTests,
  resolveWorkCanvasIdentity,
  snapshotWorkCanvasForPrompt,
  workCanvasHasBlockingQaNotes,
  workCanvasHasCompletePptReviewProjection,
  workCanvasPptSelectionState,
  workCanvasPptWorkflowGate
} from './work-canvas'

function documentWithShape(name: string) {
  const document = createEmptyDocument()
  const shape = createDefaultShape('rect', 10, 20)
  shape.name = name
  document.objects[shape.id] = { ...shape, parentId: document.rootId }
  document.objects[document.rootId]!.children.push(shape.id)
  return { document, shape }
}

const baseOptions = {
  workspaceRoot: '/work',
  boardId: 'board-1',
  selectedIds: new Set<string>(),
  viewBox: { x: 0, y: 0, width: 1200, height: 800 },
  defaultScreenSize: { width: 1280, height: 800 }
}

beforeEach(() => resetWritableWorkCanvasForTests())

describe('Work canvas identity and snapshot isolation', () => {
  it('maps one board to its durable document and feedback keys', () => {
    expect(resolveWorkCanvasIdentity('/work', ' board-1 ')).toEqual({
      workspaceRoot: '/work',
      boardId: 'board-1',
      artifactId: 'board-1',
      baseDir: '.kun-whiteboards',
      designSystemBaseDir: '.kun-whiteboards/board-1',
      documentKey: canvasDocumentKey('/work', 'board-1', '.kun-whiteboards'),
      errorKey: 'work-canvas:board-1'
    })
  })

  it('keeps unbound Work boards from accepting arbitrary PPT workflows', () => {
    expect(workCanvasPptWorkflowGate('board-1', ' workflow-1 ')).toBe('workflow-1')
    expect(workCanvasPptWorkflowGate('board-1')).toBe('__unbound-work-board__:board-1')
  })

  it('uses live selection only when the singleton store key matches the board', async () => {
    const { document, shape } = documentWithShape('Live card')
    const snapshot = await snapshotWorkCanvasForPrompt({
      ...baseOptions,
      currentDocument: document,
      currentDocumentKey: resolveWorkCanvasIdentity('/work', 'board-1').documentKey,
      selectedIds: new Set([shape.id]),
      loadDocument: vi.fn()
    })

    expect(snapshot?.shapes[0]).toMatchObject({ name: 'Live card', selected: true })
  })

  it('falls back to persisted board data and drops another canvas selection', async () => {
    const live = documentWithShape('Other board')
    const persisted = documentWithShape('Persisted work board')
    const loadDocument = vi.fn(async () => persisted.document)
    const snapshot = await snapshotWorkCanvasForPrompt({
      ...baseOptions,
      currentDocument: live.document,
      currentDocumentKey: 'another-document-key',
      selectedIds: new Set([live.shape.id, persisted.shape.id]),
      loadDocument
    })

    expect(loadDocument).toHaveBeenCalledWith(
      '/work', 'board-1', '.kun-whiteboards'
    )
    expect(snapshot?.shapes).toEqual([
      expect.objectContaining({ name: 'Persisted work board' })
    ])
    expect(snapshot?.shapes[0].selected).toBeUndefined()
  })
})

describe('Work canvas writable lease and QA gate', () => {
  it('allows exactly one writable owner until it releases the lease', () => {
    expect(claimWritableWorkCanvas('owner-a', 'board-a')).toBe(true)
    expect(claimWritableWorkCanvas('owner-b', 'board-b')).toBe(false)
    expect(currentWritableWorkCanvas()).toEqual({ ownerId: 'owner-a', boardId: 'board-a' })
    releaseWritableWorkCanvas('owner-a')
    expect(claimWritableWorkCanvas('owner-b', 'board-b')).toBe(true)
  })

  it('blocks approval only for unresolved error notes in the active workflow', () => {
    const { document, shape } = documentWithShape('QA note')
    document.objects[shape.id] = {
      ...document.objects[shape.id]!,
      agentNote: { kind: 'critique', body: 'Overflow', severity: 'error' },
      pptReviewRef: {
        workflowId: 'workflow-1', childId: 'child-1', slideId: 'slide-1',
        revision: 1, role: 'annotation'
      }
    }
    expect(workCanvasHasBlockingQaNotes(document, 'workflow-1')).toBe(true)
    expect(workCanvasHasBlockingQaNotes(document, 'workflow-2')).toBe(false)
    document.objects[shape.id]!.agentNote!.resolved = true
    expect(workCanvasHasBlockingQaNotes(document, 'workflow-1')).toBe(false)
  })

  it('enables PPT actions only for selected refs in the active workflow', () => {
    const { document, shape } = documentWithShape('Direction')
    document.objects[shape.id] = {
      ...document.objects[shape.id]!,
      pptDirectionRef: {
        workflowId: 'workflow-1', childId: 'child-1', directionId: 'direction-1',
        revision: 1, role: 'direction-card'
      }
    }
    expect(workCanvasPptSelectionState(document, new Set([shape.id]), 'workflow-1')).toEqual({
      direction: true, slides: false
    })
    expect(workCanvasPptSelectionState(document, new Set([shape.id]), 'workflow-2')).toEqual({
      direction: false, slides: false
    })
  })

  it('requires persisted frame-and-preview pairs before review approval', () => {
    const document = createEmptyDocument()
    const frame = createDefaultShape('frame', 0, 0)
    frame.pptReviewRef = {
      workflowId: 'workflow-1', childId: 'child-1', slideId: 'slide-1',
      revision: 2, role: 'slide-frame'
    }
    document.objects[frame.id] = { ...frame, parentId: document.rootId }
    document.objects[document.rootId]!.children.push(frame.id)
    expect(workCanvasHasCompletePptReviewProjection(
      document, 'workflow-1', 'child-1'
    )).toBe(false)

    const preview = createDefaultShape('image', 0, 0)
    preview.imageUrl = '.kun/images/slide-1.png'
    preview.pptReviewRef = {
      workflowId: 'workflow-1', childId: 'child-1', slideId: 'slide-1',
      revision: 2, role: 'preview-image'
    }
    document.objects[preview.id] = { ...preview, parentId: document.rootId }
    document.objects[document.rootId]!.children.push(preview.id)
    expect(workCanvasHasCompletePptReviewProjection(
      document, 'workflow-1', 'child-1'
    )).toBe(true)

    const direction = createDefaultShape('frame', 0, 0)
    direction.pptDirectionRef = {
      workflowId: 'workflow-1', childId: 'child-1', directionId: 'direction-1',
      revision: 1, role: 'direction-card'
    }
    document.objects[direction.id] = { ...direction, parentId: document.rootId }
    expect(workCanvasHasCompletePptReviewProjection(
      document, 'workflow-1', 'child-1'
    )).toBe(false)
  })
})
