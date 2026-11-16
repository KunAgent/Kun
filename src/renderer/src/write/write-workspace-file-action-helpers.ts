import i18n from '../i18n'
import { releaseLatexWorkspace } from './latex/latex-session-lifecycle'
import type {
  WriteDocumentSession,
  WriteEditorGroupId,
  WritePreviewMode,
  WriteWorkspaceGet,
  WriteWorkspaceState
} from './write-workspace-store-types'
import {
  addTabToGroup,
  clearWriteOfficeSelections,
  emptyWriteEditorGroup,
  persistWriteEditorLayout,
  projectFocusedDocument,
  writeDocumentKey,
  writeEditorItemKey
} from './write-editor-layout'

export function formatWriteFileActionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function openWriteDocumentState(
  state: WriteWorkspaceState,
  document: WriteDocumentSession,
  groupId: WriteEditorGroupId,
  viewMode: WritePreviewMode
): Partial<WriteWorkspaceState> {
  const documentsByPath = {
    ...clearWriteOfficeSelections(state.documentsByPath),
    [writeDocumentKey(document.path)]: document
  }
  const editorLayout = addTabToGroup(state.editorLayout, groupId, document.path, viewMode)
  persistWriteEditorLayout(state.workspaceRoot, editorLayout)
  return { documentsByPath, editorLayout, ...projectFocusedDocument(editorLayout, documentsByPath) }
}

export function removeFailedRestoredWriteTab(
  layout: WriteWorkspaceState['editorLayout'],
  groupId: WriteEditorGroupId,
  path: string
): WriteWorkspaceState['editorLayout'] {
  return {
    ...layout,
    groups: layout.groups.map((group) => group.id === groupId
      ? {
          ...group,
          tabs: group.tabs.filter((tab) => writeEditorItemKey(tab) !== path),
          activePath: group.activePath === path ? null : group.activePath
        }
      : group)
  }
}

export function finishRestoredWriteLayout(
  layout: WriteWorkspaceState['editorLayout'],
  unavailableGroups: Set<WriteEditorGroupId>
): WriteWorkspaceState['editorLayout'] {
  const available = layout.groups.filter((group) => !unavailableGroups.has(group.id))
  if (available.length === 0) {
    return { ...layout, orientation: 'single', focusedGroupId: 'primary', groups: [emptyWriteEditorGroup('primary')] }
  }
  if (available.length === 1) {
    return {
      ...layout,
      orientation: 'single',
      focusedGroupId: 'primary',
      groups: [{ ...available[0], id: 'primary' }]
    }
  }
  const groups = available.slice(0, 2).map((group, index) => ({
    ...group,
    id: index === 0 ? 'primary' as const : 'secondary' as const
  }))
  return {
    ...layout,
    groups,
    focusedGroupId: groups.some((group) => group.id === layout.focusedGroupId)
      ? layout.focusedGroupId
      : 'primary'
  }
}

export async function prepareActiveWriteFileForNavigation(
  get: WriteWorkspaceGet,
  workspaceRoot: string
): Promise<boolean> {
  const state = get()
  const dirtyDocuments = Object.values(state.documentsByPath).filter(
    (document) => (document.kind === 'text' || document.kind === 'latex') && document.saveStatus !== 'saved'
  )
  if (dirtyDocuments.length === 0) return true
  if (state.autoSaveEnabled) return get().saveAllDocuments(workspaceRoot)
  if (window.confirm(i18n.t('common:writeSaveAllUnsavedConfirm'))) {
    return get().saveAllDocuments(workspaceRoot)
  }
  const discard = window.confirm(i18n.t('common:writeDiscardUnsavedChangesConfirm'))
  if (discard) releaseLatexWorkspace(workspaceRoot, true)
  return discard
}
