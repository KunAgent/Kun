import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { WorkspaceEntry } from '@shared/workspace-file'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import { revealWorkspacePathInFileManager } from '../../lib/open-workspace-path'
import { useChatStore } from '../../store/chat-store'
import {
  useWriteWorkspaceStore,
  writeBasenameFromPath,
  writeDirnameFromPath,
  writeJoinPath,
  writeRelativeToWorkspace
} from '../../write/write-workspace-store'
import { renameWorkWhiteboardSession } from '../../write/work-whiteboard-session-title'
import { mountWorkSpace } from '../../write/work-session-actions'
import type { WriteEntryDialogKind } from './WriteEntryDialog'
import { useWorkWhiteboardCreation } from './use-work-whiteboard-creation'

/**
 * File operations shared by the Work sidebar's primary actions and its
 * directory view: create/rename/delete dialogs, workspace picking, reveal and
 * whiteboard creation. Creating a document always targets a work space, so
 * it first leaves a mounted paper library.
 */
export function useWorkDirectoryActions() {
  const renameThread = useChatStore((s) => s.renameThread)
  const [entryDialog, setEntryDialog] = useState<WriteEntryDialogKind | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)
  const revealErrorTimerRef = useRef<number | null>(null)
  const {
    defaultWorkspaceRoot,
    workspaceRoot,
    rootDirectory,
    activeFilePath,
    workSurface,
    addWriteWorkspace,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry,
    setFileError,
    renameWhiteboard,
    deleteWhiteboard
  } = useWriteWorkspaceStore(useShallow((s) => ({
    defaultWorkspaceRoot: s.defaultWorkspaceRoot,
    workspaceRoot: s.workspaceRoot,
    rootDirectory: s.rootDirectory,
    activeFilePath: s.activeFilePath,
    workSurface: s.workSurface,
    addWriteWorkspace: s.addWriteWorkspace,
    createFile: s.createFile,
    createDirectory: s.createDirectory,
    renameEntry: s.renameEntry,
    deleteEntry: s.deleteEntry,
    setFileError: s.setFileError,
    renameWhiteboard: s.renameWhiteboard,
    deleteWhiteboard: s.deleteWhiteboard
  })))
  const root = rootDirectory || workspaceRoot

  useEffect(() => {
    setRevealError(null)
    if (revealErrorTimerRef.current) window.clearTimeout(revealErrorTimerRef.current)
    revealErrorTimerRef.current = null
    return () => {
      if (revealErrorTimerRef.current) window.clearTimeout(revealErrorTimerRef.current)
    }
  }, [workspaceRoot])

  const revealWritePath = async (targetPath: string, boundaryRoot: string): Promise<void> => {
    const result = await revealWorkspacePathInFileManager(targetPath, boundaryRoot)
    if (revealErrorTimerRef.current) window.clearTimeout(revealErrorTimerRef.current)
    if (result.ok) {
      revealErrorTimerRef.current = null
      setRevealError(null)
      return
    }
    setRevealError(result.message)
    revealErrorTimerRef.current = window.setTimeout(() => {
      revealErrorTimerRef.current = null
      setRevealError(null)
    }, 3_600)
  }

  const pickWriteWorkspace = async (): Promise<void> => {
    try {
      setFileError(null)
      if (typeof window.kunGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.kunGui.pickWorkspaceDirectory(workspaceRoot || defaultWorkspaceRoot || undefined)
      // The first send starts the space's session; nothing is created up front.
      if (!picked.canceled && picked.path) await addWriteWorkspace(picked.path)
    } catch (error) {
      setFileError(formatWorkspacePickerError(error))
    }
  }

  const suggestedCreatePath = (kind: 'file' | 'folder', parentDirectory?: string): { parent: string; suggested: string } => {
    const explicitParent = parentDirectory?.trim()
    const fallback = activeFilePath && root && activeFilePath.startsWith(root)
      ? writeDirnameFromPath(activeFilePath)
      : root || workspaceRoot
    const parent = explicitParent || fallback
    const relativeParent = writeRelativeToWorkspace(root, parent)
    const baseName = kind === 'file' ? 'untitled.md' : 'new-folder'
    const suggested = explicitParent
      ? baseName
      : relativeParent === writeBasenameFromPath(root) ? baseName : `${relativeParent}/${baseName}`
    return { parent: explicitParent || root, suggested }
  }

  const ensureDocsSpace = async (): Promise<boolean> => {
    const state = useWriteWorkspaceStore.getState()
    if (state.workSurface === 'docs' && state.workspaceRoot.trim()) return true
    const target = state.workspaceRoots[0] || state.defaultWorkspaceRoot
    if (!target) {
      await pickWriteWorkspace()
      return false
    }
    return mountWorkSpace(target)
  }

  const openCreateFileDialog = async (parentDirectory?: string): Promise<void> => {
    if (!parentDirectory && workSurface !== 'docs') {
      // The space mounts after this render; suggest a root-level name.
      if (await ensureDocsSpace()) setEntryDialog({ kind: 'create-file', value: 'untitled.md' })
      return
    }
    if (!workspaceRoot.trim() || !root) {
      await pickWriteWorkspace()
      return
    }
    setEntryDialog({ kind: 'create-file', parentDirectory, value: suggestedCreatePath('file', parentDirectory).suggested })
  }

  const openCreateDirectoryDialog = async (parentDirectory?: string): Promise<void> => {
    if (!workspaceRoot.trim() || !root) {
      await pickWriteWorkspace()
      return
    }
    setEntryDialog({ kind: 'create-folder', parentDirectory, value: suggestedCreatePath('folder', parentDirectory).suggested })
  }

  const openRenameEntryDialog = (entry: WorkspaceEntry): void => {
    setEntryDialog({ kind: 'rename', entry, value: entry.name })
  }

  const openDeleteEntryDialog = (entry: WorkspaceEntry): void => {
    setEntryDialog({ kind: 'delete', entry })
  }

  const submitEntryDialog = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!entryDialog) return
    if (entryDialog.kind === 'delete-whiteboard') {
      if (await deleteWhiteboard(entryDialog.board.id)) setEntryDialog(null)
      return
    }
    if (entryDialog.kind === 'delete') {
      if (await deleteEntry(workspaceRoot, entryDialog.entry.path)) setEntryDialog(null)
      return
    }
    const value = entryDialog.value.trim()
    if (!value) return
    if (entryDialog.kind === 'rename-whiteboard') {
      if (value === entryDialog.board.title) {
        setEntryDialog(null)
        return
      }
      if (await renameWorkWhiteboardSession({
        board: entryDialog.board,
        title: value,
        renameSession: renameThread,
        readSessionTitle: (threadId) => useChatStore.getState().threads
          .find((thread) => thread.id === threadId)?.title ?? null,
        renameWhiteboard
      })) setEntryDialog(null)
      return
    }
    if (entryDialog.kind === 'rename') {
      if (value === entryDialog.entry.name) {
        setEntryDialog(null)
        return
      }
      if (await renameEntry(workspaceRoot, entryDialog.entry.path, value)) setEntryDialog(null)
      return
    }
    const { parent } = suggestedCreatePath(entryDialog.kind === 'create-file' ? 'file' : 'folder', entryDialog.parentDirectory)
    const created = entryDialog.kind === 'create-file'
      ? await createFile(workspaceRoot, writeJoinPath(parent, value))
      : await createDirectory(workspaceRoot, writeJoinPath(parent, value))
    if (created) setEntryDialog(null)
  }

  const whiteboardCreation = useWorkWhiteboardCreation({ workspaceRoot, onNeedWorkspace: pickWriteWorkspace })

  const openNewWhiteboard = async (): Promise<void> => {
    if (workSurface !== 'docs' && !(await ensureDocsSpace())) return
    whiteboardCreation.openNewWhiteboardDialog()
  }

  return {
    root,
    entryDialog,
    setEntryDialog,
    revealError,
    revealWritePath,
    pickWriteWorkspace,
    openCreateFileDialog,
    openCreateDirectoryDialog,
    openRenameEntryDialog,
    openDeleteEntryDialog,
    submitEntryDialog,
    whiteboardCreation,
    openNewWhiteboard
  }
}

export type WorkDirectoryActions = ReturnType<typeof useWorkDirectoryActions>
