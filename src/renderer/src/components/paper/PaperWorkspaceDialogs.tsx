import type { ReactElement } from 'react'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { PaperImportDialogHost } from './PaperImportDialogHost'
import { PaperReadingDialogHost } from './evidence/PaperReadingDialog'

/** Dialogs stay visible when the document canvas is behind the assistant. */
export function PaperWorkspaceDialogs(): ReactElement {
  const workspaceRoot = useWriteWorkspaceStore((state) => state.workspaceRoot)
  const paperReading = useWriteWorkspaceStore((state) => state.paperReading)
  return <>
    <PaperReadingDialogHost />
    <PaperImportDialogHost workspaceRoot={workspaceRoot} paperReading={paperReading} />
  </>
}
