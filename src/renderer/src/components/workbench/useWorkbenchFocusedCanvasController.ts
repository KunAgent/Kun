import { useCallback } from 'react'
import { useChatStore } from '../../store/chat-store'

export type WorkbenchFocusedCanvasController = {
  canvasFocusMode: boolean
  exitCanvasFocusMode: () => void
  startNewDesignCanvasConversation: () => Promise<void>
}

/**
 * Bundles the focused-whiteboard presentation state with the "new design
 * conversation" action so Workbench.tsx stays under the file-size gate.
 */
export function useWorkbenchFocusedCanvasController(layout: {
  canvasFocusMode: boolean
  exitCanvasFocusMode: () => void
}, options: {
  designWorkspaceRoot: string
  workspaceRoot: string
  designActiveDocumentId: string | null
  lockedDesignDocumentId?: string
}): WorkbenchFocusedCanvasController {
  const { canvasFocusMode, exitCanvasFocusMode } = layout
  const startNewDesignCanvasConversation = useCallback(async (): Promise<void> => {
    // New conversation for the SAME drawing: append and activate another
    // registered design thread without clearing history or the canvas.
    const documentId = options.lockedDesignDocumentId ?? options.designActiveDocumentId
    if (!documentId) return
    await useChatStore.getState().createDesignThread(
      options.designWorkspaceRoot || options.workspaceRoot,
      documentId
    )
  }, [options])
  return { canvasFocusMode, exitCanvasFocusMode, startNewDesignCanvasConversation }
}
