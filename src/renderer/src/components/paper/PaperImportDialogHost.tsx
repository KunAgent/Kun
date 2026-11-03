import { type ReactElement } from 'react'
import type { WritePaperReadingSettingsV1 } from '@shared/app-settings'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { PaperImportDialog } from './import/PaperImportDialog'

/**
 * Import dialog mounted at the paper-workbench level. It is kept mounted while
 * hidden so closing does not cancel work or discard per-item results.
 */
export function PaperImportDialogHost({
  workspaceRoot: _workspaceRoot,
  paperReading: _paperReading
}: {
  workspaceRoot: string
  paperReading: WritePaperReadingSettingsV1
}): ReactElement | null {
  const open = usePaperModeStore((s) => s.importDialogOpen)
  const setOpen = usePaperModeStore((s) => s.setImportDialogOpen)
  if (!open) return null
  return <PaperImportDialog onClose={() => setOpen(false)} />
}
