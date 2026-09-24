import { useMemo, type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import type { WritePaperReadingSettingsV1 } from '@shared/app-settings'
import { useWritePaperMode } from '../../write/paper/use-write-paper-mode'
import { usePaperStore } from '../../write/paper/paper-store'
import { cancelPaperJob, importPaper } from '../../write/paper/paper-actions'
import { WritePaperStrip } from './paper/WritePaperStrip'
import { WritePaperImportDialog } from './paper/WritePaperImportDialog'

/**
 * Paper-reading slots for the ordinary Write workspace: the paper strip above
 * the editor, the import dialog, and the open-import callback. Kept out of
 * WriteWorkspaceView so the paper-mode workbench can mount a different set of
 * slots while this file stays under the line limit.
 */
export function usePaperSurfaceSlots(props: {
  workspaceRoot: string
  paperReading: WritePaperReadingSettingsV1
  activeFilePath: string | null
  input: string
  setInput: (value: string) => void
  onSubmitPrompt?: (value: string) => void
  t: TFunction
}): {
  paperBar: ReactElement
  paperDialog: ReactElement | null
  openPaperImport: () => void
} {
  const { workspaceRoot, paperReading, activeFilePath, input, setInput, onSubmitPrompt, t } = props
  const paper = useWritePaperMode(workspaceRoot)
  const paperImportOpen = usePaperStore((s) => s.importOpen)
  const setPaperImportOpen = usePaperStore((s) => s.setImportOpen)
  const paperDeps = useMemo(
    () => ({ workspaceRoot, settings: paperReading, t }),
    [workspaceRoot, paperReading, t]
  )

  const paperBar = (
    <WritePaperStrip
      workspaceRoot={workspaceRoot}
      paperReading={paperReading}
      unitDir={paper.unitDir}
      meta={paper.meta}
      loosePdfPath={paper.loosePdf ? activeFilePath : null}
      input={input}
      setInput={setInput}
      onSubmitPrompt={onSubmitPrompt}
      t={t}
    />
  )

  const paperDialog = paperImportOpen ? (
    <WritePaperImportDialog
      onImport={(value) =>
        importPaper({ ...paperDeps, input: value })
      }
      onImportPdf={(localPdfPath) =>
        importPaper({ ...paperDeps, localPdfPath })
      }
      onCancel={() => cancelPaperJob('import')}
      onClose={() => setPaperImportOpen(false)}
    />
  ) : null

  return {
    paperBar,
    paperDialog,
    openPaperImport: () => setPaperImportOpen(true)
  }
}
