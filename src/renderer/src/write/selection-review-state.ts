import { useWriteWorkspaceStore } from './write-workspace-store'
import { writeDocumentKey } from './write-editor-layout'

/** Release a discarded selection review on its owning file, even after a tab switch. */
export function clearAbandonedSelectionReview(filePath: string): void {
  const key = writeDocumentKey(filePath)
  useWriteWorkspaceStore.setState((state) => {
    const document = state.documentsByPath[key]
    return {
      ...(state.activeFilePath && writeDocumentKey(state.activeFilePath) === key ? { reviewActive: false } : {}),
      ...(document ? { documentsByPath: { ...state.documentsByPath, [key]: { ...document, reviewActive: false } } } : {})
    }
  })
}
