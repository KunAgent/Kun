import { afterEach, describe, expect, it } from 'vitest'
import { useCanvasShapeStore } from '../../design/canvas/canvas-shape-store'
import { createDefaultShape, createEmptyDocument, type CanvasShape } from '../../design/canvas/canvas-types'
import { useCanvasSelectionStore } from '../../design/canvas/canvas-selection-store'
import { activePptReviewComposerContexts } from './workbench-ppt-review-context'

function reviewShapes(workflowId: string, childId: string, slideId: string): CanvasShape[] {
  const frame = createDefaultShape('frame', 0, 0)
  const preview = createDefaultShape('image', 0, 0)
  preview.imageUrl = `.kun/images/${slideId}.png`
  return [{
    ...frame,
    id: `${workflowId}-frame`,
    pptReviewRef: {
      workflowId,
      childId,
      slideId,
      revision: 2,
      parentThreadId: 'thread-a',
      role: 'slide-frame'
    }
  } satisfies CanvasShape, {
    ...preview,
    id: `${workflowId}-preview`,
    pptReviewRef: {
      workflowId,
      childId,
      slideId,
      revision: 2,
      parentThreadId: 'thread-a',
      role: 'preview-image'
    }
  } satisfies CanvasShape]
}

function loadReviewDocument(documentKey: string): void {
  const document = createEmptyDocument()
  const shapes = [
    ...reviewShapes('workflow-a', 'child-a', 'slide-a'),
    ...reviewShapes('workflow-b', 'child-b', 'slide-b')
  ]
  useCanvasShapeStore.getState().loadDocument({
    ...document,
    objects: {
      ...document.objects,
      ...Object.fromEntries(shapes.map((shape) => [shape.id, shape]))
    }
  }, documentKey)
}

afterEach(() => {
  useCanvasShapeStore.getState().resetDocument()
  useCanvasSelectionStore.getState().clearSelection()
})

describe('active Work PPT composer contexts', () => {
  it('returns no context when the active canvas document changed before send', async () => {
    loadReviewDocument('work-board-a')

    await expect(activePptReviewComposerContexts('/work', 'thread-a', {
      expectedDocumentKey: 'work-board-b',
      workflowId: 'workflow-a'
    })).resolves.toEqual([])
  })

  it('admits only the active board workflow from a shared thread', async () => {
    loadReviewDocument('work-board-a')

    const contexts = await activePptReviewComposerContexts('/work', 'thread-a', {
      expectedDocumentKey: 'work-board-a',
      workflowId: 'workflow-b',
      phase: 'review'
    })

    expect(contexts).toHaveLength(1)
    expect(contexts[0]?.reference).toMatchObject({
      kind: 'ppt-review',
      workflowId: 'workflow-b',
      childId: 'child-b',
      slides: [{ slideId: 'slide-b', revision: 2 }]
    })
  })

  it('never submits stale direction context while the board is in review', async () => {
    const document = createEmptyDocument()
    const direction = createDefaultShape('frame', 0, 0)
    direction.pptDirectionRef = {
      workflowId: 'workflow-a', childId: 'child-a', directionId: 'direction-a',
      revision: 1, parentThreadId: 'thread-a', role: 'direction-card'
    }
    useCanvasShapeStore.getState().loadDocument({
      ...document,
      objects: { ...document.objects, [direction.id]: direction }
    }, 'work-board-a')
    useCanvasSelectionStore.getState().select([direction.id])

    await expect(activePptReviewComposerContexts('/work', 'thread-a', {
      expectedDocumentKey: 'work-board-a',
      workflowId: 'workflow-a',
      phase: 'review'
    })).resolves.toEqual([])
  })
})
