import type { WriteAssistantMessageContext } from '../../store/chat-store-types'
import { canvasDocumentKey } from '../../design/canvas/canvas-persistence'
import type { WorkWhiteboard, WriteWorkspaceState } from '../../write/write-workspace-store-types'
import { workWhiteboardArtifactId, workWhiteboardBaseDir } from '../../write/work-whiteboard'
import { activePptReviewComposerContexts } from './workbench-ppt-review-context'
import { useCanvasShapeStore } from '../../design/canvas/canvas-shape-store'
import { useCanvasSelectionStore } from '../../design/canvas/canvas-selection-store'
import { useCanvasViewportStore } from '../../design/canvas/canvas-viewport-store'
import {
  buildWorkCanvasReferenceContext,
  workCanvasReferenceIntent
} from '../../design/canvas/work-canvas-outbound'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'

export function activeWorkWhiteboard(state: WriteWorkspaceState): WorkWhiteboard | null {
  return state.activeWhiteboardId ? state.whiteboards[state.activeWhiteboardId] ?? null : null
}

export function activeWorkWhiteboardForSend(
  state: WriteWorkspaceState
): WorkWhiteboard | null | undefined {
  const board = activeWorkWhiteboard(state)
  return board && !board.threadId?.trim() ? undefined : board
}

export function workWhiteboardSnapshotMatches(
  state: WriteWorkspaceState,
  snapshot: WorkWhiteboard | null
): boolean {
  if (!snapshot) return state.activeWhiteboardId === null
  const current = state.whiteboards[snapshot.id]
  return state.activeWhiteboardId === snapshot.id &&
    current?.revision === snapshot.revision &&
    current.threadId === snapshot.threadId
}

export async function activeWorkWhiteboardComposerContexts(
  workspaceRoot: string,
  board: WorkWhiteboard | null,
  fallbackThreadId: string | null,
  userPrompt?: string
) {
  if (!board) return []
  const canvas = useCanvasShapeStore.getState()
  const whiteboard = await buildWorkCanvasReferenceContext({
    workspaceRoot,
    boardId: board.id,
    boardRevision: board.revision,
    currentDocument: canvas.document,
    currentDocumentKey: canvas.documentKey,
    selectedIds: useCanvasSelectionStore.getState().selectedIds,
    viewBox: useCanvasViewportStore.getState().vbox,
    designContext: useDesignWorkspaceStore.getState().designContext,
    intent: workCanvasReferenceIntent(userPrompt ?? '')
  })
  if (!board.workflowId) return [whiteboard]
  const ppt = await activePptReviewComposerContexts(
    workspaceRoot,
    board.threadId || fallbackThreadId,
    {
      expectedDocumentKey: canvasDocumentKey(
        workspaceRoot,
        workWhiteboardArtifactId(board.id),
        workWhiteboardBaseDir()
      ),
      workflowId: board.workflowId,
      phase: board.phase
    }
  )
  return [whiteboard, ...ppt]
}

export function workWhiteboardMessageFence(
  board: WorkWhiteboard | null
): Partial<WriteAssistantMessageContext> {
  if (!board) return {}
  return {
    whiteboardId: board.id,
    whiteboardRevision: board.revision,
    ...(board.threadId ? { threadId: board.threadId } : {})
  }
}
