import { type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import type { WritePaperReadingSettingsV1 } from '@shared/app-settings'
import { useWritePaperMode } from '../../write/paper/use-write-paper-mode'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { WritePaperStrip } from './paper/WritePaperStrip'

/**
 * Paper slot above the editor: a loose PDF (outside the papers folder) gets
 * the "add to papers" hint; unit actions live in the reader's floating
 * controls and the info drawer. Importing goes through the space's dialog.
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
  paperBar: ReactElement | null
  /** The active file belongs to a paper unit (its reader owns the chrome). */
  inPaperUnit: boolean
  openPaperImport: () => void
} {
  const { workspaceRoot, paperReading, activeFilePath, input, setInput, onSubmitPrompt, t } = props
  const paper = useWritePaperMode(workspaceRoot)
  const paperBar = paper.loosePdf ? (
    <WritePaperStrip
      workspaceRoot={workspaceRoot}
      paperReading={paperReading}
      unitDir={null}
      meta={null}
      loosePdfPath={activeFilePath}
      input={input}
      setInput={setInput}
      onSubmitPrompt={onSubmitPrompt}
      t={t}
    />
  ) : null
  return {
    paperBar,
    inPaperUnit: Boolean(paper.unitDir),
    openPaperImport: () => usePaperModeStore.getState().setImportDialogOpen(true)
  }
}
