import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import {
  isWriteFileTab,
  writeDocumentKey,
  writeEditorItemForKey
} from '../write/write-editor-layout'

/**
 * R2.3「左右对照」: open the current PDF in the secondary group as a
 * read-only `translated` mirror; calling again while mirrored closes the
 * secondary group.
 */
export function togglePaperTranslatedMirror(filePath: string): void {
  const store = useWriteWorkspaceStore.getState()
  const key = writeDocumentKey(filePath)
  const secondary = store.editorLayout.groups.find((group) => group.id === 'secondary')
  const twin = secondary ? writeEditorItemForKey(secondary, key) : null
  if (twin && isWriteFileTab(twin) && twin.pdfView === 'translated') {
    store.closeEditorGroup('secondary')
    return
  }
  if (store.editorLayout.groups.length < 2) {
    store.splitEditorGroup('horizontal', filePath)
  }
  const state = useWriteWorkspaceStore.getState()
  const secondaryNow = state.editorLayout.groups.find((group) => group.id === 'secondary')
  if (!secondaryNow) return
  // The split copies the active tab; ensure the twin exists and is flagged.
  if (!writeEditorItemForKey(secondaryNow, key)) {
    void state.openFile(state.workspaceRoot, filePath, { groupId: 'secondary' }).then(() => {
      useWriteWorkspaceStore.getState().setTabPdfView('secondary', filePath, 'translated')
      useWriteWorkspaceStore.getState().focusEditorGroup('primary')
    })
    return
  }
  state.setTabPdfView('secondary', filePath, 'translated')
  state.focusEditorGroup('primary')
}
