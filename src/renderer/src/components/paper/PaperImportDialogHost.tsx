import type { ReactElement } from 'react'
import type { WritePaperReadingSettingsV1 } from '@shared/app-settings'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { PaperImportDialog } from './import/PaperImportDialog'

/**
 * Import dialog mounted at the paper-workbench level so it stays usable while
 * the library/discover views hide the reader DOM (plan §3.4). Controlled by
 * `usePaperModeStore.importDialogOpen`; the docs-surface dialog inside
 * WriteWorkspaceView uses `usePaperStore.importOpen` instead.
 */
export function PaperImportDialogHost({
  workspaceRoot,
  paperReading
}: {
  workspaceRoot: string
  paperReading: WritePaperReadingSettingsV1
}): ReactElement | null {
  const open = usePaperModeStore((s) => s.importDialogOpen)
  const setOpen = usePaperModeStore((s) => s.setImportDialogOpen)
  if (!open) return null
  return (
    <PaperImportDialog
      workspaceRoot={workspaceRoot}
      papersDir={paperReading.papersDir || 'papers'}
      onClose={() => setOpen(false)}
    />
  )
}
