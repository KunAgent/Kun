import { useEffect, useMemo } from 'react'
import type { ComposerFileReference } from '../../lib/composer-file-references'
import { pickWorkComposerReferences, useWorkComposerReferences } from '../../write/work-composer-references'

/**
 * @-references for a Work composer, as in Code: type @ to pick a file or folder
 * of the space, drop one from the Files tree, or add local files from "+".
 */
export function useWorkComposerReferenceProps(spaceRoot: string): {
  fileReferenceEnabled: boolean
  fileReferences: ComposerFileReference[]
  onAddFileReference: (reference: ComposerFileReference) => void
  onRemoveFileReference: (relativePath: string) => void
  onPickFileReferences: () => void
} {
  const references = useWorkComposerReferences((state) => state.references)
  useEffect(() => {
    useWorkComposerReferences.getState().bindSpace(spaceRoot)
  }, [spaceRoot])
  return useMemo(() => ({
    fileReferenceEnabled: Boolean(spaceRoot),
    fileReferences: references,
    onAddFileReference: (reference) => useWorkComposerReferences.getState().add(reference),
    onRemoveFileReference: (relativePath) => useWorkComposerReferences.getState().remove(relativePath),
    onPickFileReferences: () => { void pickWorkComposerReferences(spaceRoot) }
  }), [references, spaceRoot])
}
