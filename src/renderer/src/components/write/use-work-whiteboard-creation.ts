import { useCallback, useState } from 'react'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import type { CanvasEngine } from '../../whiteboard/canvas-engine'

/**
 * Title-first creation flow for the Work sidebar. The `+` action only opens
 * the dialog; the board is persisted after the user submits a valid title.
 */
export function useWorkWhiteboardCreation(input: {
  workspaceRoot: string
  onNeedWorkspace: () => Promise<void>
}): {
  newWhiteboardDialogOpen: boolean
  creatingWhiteboard: boolean
  openNewWhiteboardDialog: () => Promise<void>
  submitNewWhiteboardTitle: (title: string, engine?: CanvasEngine) => Promise<void>
  closeNewWhiteboardDialog: () => void
} {
  const createWhiteboard = useWriteWorkspaceStore((s) => s.createWhiteboard)
  const [newWhiteboardDialogOpen, setNewWhiteboardDialogOpen] = useState(false)
  const [creatingWhiteboard, setCreatingWhiteboard] = useState(false)

  const openNewWhiteboardDialog = useCallback(async (): Promise<void> => {
    if (!input.workspaceRoot.trim()) {
      await input.onNeedWorkspace()
      return
    }
    setNewWhiteboardDialogOpen(true)
  }, [input.onNeedWorkspace, input.workspaceRoot])

  const submitNewWhiteboardTitle = useCallback(async (title: string, engine?: CanvasEngine): Promise<void> => {
    if (!input.workspaceRoot.trim()) {
      setNewWhiteboardDialogOpen(false)
      await input.onNeedWorkspace()
      return
    }
    setCreatingWhiteboard(true)
    const board = await createWhiteboard(input.workspaceRoot, { title, ...(engine ? { engine } : {}) })
    setCreatingWhiteboard(false)
    if (board) setNewWhiteboardDialogOpen(false)
  }, [createWhiteboard, input.onNeedWorkspace, input.workspaceRoot])

  const closeNewWhiteboardDialog = useCallback((): void => {
    setNewWhiteboardDialogOpen(false)
  }, [])

  return {
    newWhiteboardDialogOpen,
    creatingWhiteboard,
    openNewWhiteboardDialog,
    submitNewWhiteboardTitle,
    closeNewWhiteboardDialog
  }
}
