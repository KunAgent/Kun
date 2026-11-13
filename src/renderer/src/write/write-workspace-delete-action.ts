import type { WriteWorkspaceGet, WriteWorkspaceSet, WriteWorkspaceState } from './write-workspace-store-types'
import { forgetLatexEntry, finishLatexEntryDeletion, prepareLatexEntryDeletion } from './latex/latex-session-lifecycle'
import { forgetWriteFileThreads, moveWriteFileThreads, saveWriteThreadRegistry } from './write-thread-registry'
import { nextWriteDocumentEpoch } from './write-document-context'
import { isWriteFileTab, persistWriteEditorLayout, projectFocusedDocument, writeDocumentKey, writeEditorItemKey, writeWhiteboardIdFromTabKey } from './write-editor-layout'
import { normalizePath, rememberActiveFile } from './write-workspace-store-helpers'
import { formatWriteFileActionError } from './write-workspace-file-action-helpers'

export function createWriteDeleteAction({ set, get, cancelExternalSyncAnimation, workspaceIsCurrent }: {
  set: WriteWorkspaceSet
  get: WriteWorkspaceGet
  cancelExternalSyncAnimation: () => void
  workspaceIsCurrent: (workspaceRoot: string) => boolean
}): WriteWorkspaceState['deleteEntry'] {
  return async (workspaceRoot, path) => {
    cancelExternalSyncAnimation()
    const preparation = await prepareLatexEntryDeletion(workspaceRoot, path)
    if (!preparation.ok) { set({ fileError: preparation.message }); return false }
    let result: Awaited<ReturnType<typeof window.kunGui.deleteWorkspaceEntry>>
    try {
      if (!workspaceIsCurrent(workspaceRoot)) return false
      result = await window.kunGui.deleteWorkspaceEntry({ workspaceRoot, path })
    } catch (error) {
      if (workspaceIsCurrent(workspaceRoot)) set({ fileError: formatWriteFileActionError(error) })
      return false
    } finally { finishLatexEntryDeletion(preparation.owners) }
    if (!workspaceIsCurrent(workspaceRoot)) return false
    if (!result.ok) { set({ fileError: result.message }); return false }
    const changes = forgetLatexEntry(workspaceRoot, result.path)
    for (const change of changes) saveWriteThreadRegistry(moveWriteFileThreads(workspaceRoot, change.previousPath, change.nextPath))
    saveWriteThreadRegistry(forgetWriteFileThreads(workspaceRoot, result.path))
    const deletedPath = normalizePath(result.path)
    const removed = (candidate: string): boolean => {
      const normalized = normalizePath(candidate)
      return normalized === deletedPath || normalized.startsWith(`${deletedPath}/`)
    }
    const rebound = (candidate: string): string => changes.find((change) => writeDocumentKey(change.previousPath) === writeDocumentKey(candidate))?.nextPath ?? candidate
    set((state) => {
      const expandedDirs = new Set([...state.expandedDirs].filter((directory) => !removed(directory)))
      const groups = state.editorLayout.groups.map((group) => {
        const tabs = group.tabs.map((tab) => isWriteFileTab(tab) ? { ...tab, path: rebound(tab.path) } : tab)
          .filter((tab) => !isWriteFileTab(tab) || !removed(tab.path))
        const activePath = group.activePath ? rebound(group.activePath) : null
        return { ...group, tabs, activePath: activePath && (writeWhiteboardIdFromTabKey(activePath) || !removed(activePath))
          ? activePath : tabs[0] ? writeEditorItemKey(tabs[0]) : null }
      })
      const editorLayout = { ...state.editorLayout, groups }
      const documentsByPath: WriteWorkspaceState['documentsByPath'] = {}
      for (const document of Object.values(state.documentsByPath)) {
        const nextPath = rebound(document.path)
        if (removed(nextPath)) continue
        documentsByPath[writeDocumentKey(nextPath)] = nextPath === document.path ? document : {
          ...document, path: nextPath, documentEpoch: nextWriteDocumentEpoch(document.documentEpoch)
        }
      }
      persistWriteEditorLayout(workspaceRoot, editorLayout)
      return { expandedDirs, documentsByPath, editorLayout, ...projectFocusedDocument(editorLayout, documentsByPath) }
    })
    rememberActiveFile(workspaceRoot, get().activeFilePath)
    await get().refreshWorkspace(workspaceRoot)
    return true
  }
}
