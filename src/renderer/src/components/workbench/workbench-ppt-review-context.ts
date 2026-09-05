import { serializeActivePptReviewContexts } from '../../design/canvas/ppt-review-board'
import { createPptReviewComposerContextAttachments } from '../../design/canvas/ppt-review-composer-context'
import { useCanvasShapeStore } from '../../design/canvas/canvas-shape-store'
import { useCanvasSelectionStore } from '../../design/canvas/canvas-selection-store'
import { serializeActivePptDirectionContexts } from '../../design/canvas/ppt-direction-board'
import { createPptDirectionComposerContextAttachments } from '../../design/canvas/ppt-direction-composer-context'

export type ActivePptComposerContextScope = {
  expectedDocumentKey?: string
  workflowId?: string
  phase?: 'blank' | 'directions' | 'review' | 'complete'
}

export async function activePptReviewComposerContexts(
  workspaceRoot: string,
  threadId: string | null,
  scope: ActivePptComposerContextScope = {}
) {
  if (!threadId) return []
  const canvas = useCanvasShapeStore.getState()
  if (scope.expectedDocumentKey && canvas.documentKey !== scope.expectedDocumentKey) return []
  const workflowId = scope.workflowId?.trim()
  const shapes = Object.values(canvas.document.objects).filter((shape) => {
    if (!workflowId) return true
    if (shape.pptReviewRef && shape.pptReviewRef.workflowId !== workflowId) return false
    if (shape.pptDirectionRef && shape.pptDirectionRef.workflowId !== workflowId) return false
    return true
  })
  const reviews = serializeActivePptReviewContexts(shapes, threadId)
    .filter((workflow) => !workflowId || workflow.workflowId === workflowId)
  const directions = serializeActivePptDirectionContexts(
    shapes, useCanvasSelectionStore.getState().selectedIds, threadId)
    .filter((workflow) => !workflowId || workflow.workflowId === workflowId)
  const [reviewContexts, directionContexts] = await Promise.all([
    createPptReviewComposerContextAttachments({ workspaceRoot, threadId, workflows: reviews }),
    createPptDirectionComposerContextAttachments({ workspaceRoot, threadId, workflows: directions })
  ])
  if (scope.phase === 'directions') return directionContexts
  if (scope.phase === 'review' || scope.phase === 'complete') return reviewContexts
  return [...reviewContexts, ...directionContexts]
}
