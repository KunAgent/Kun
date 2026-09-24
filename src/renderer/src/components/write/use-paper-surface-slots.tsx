import { type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import { GraduationCap } from 'lucide-react'
import type { WritePaperReadingSettingsV1 } from '@shared/app-settings'
import type { WriteWorkSurface } from '../../write/write-surface'
import { useWritePaperMode } from '../../write/paper/use-write-paper-mode'
import { usePaperStore } from '../../write/paper/paper-store'
import { enterPaperMode } from '../../paper/paper-mode-actions'
import { WritePaperStrip } from './paper/WritePaperStrip'
import { PaperImportDialog } from '../paper/import/PaperImportDialog'

/**
 * Paper-reading slots for the Write workspace: the paper strip above the
 * editor, the import dialog, and the open-import callback. The docs surface
 * shows a one-line "open in paper mode" notice for unit files; the papers
 * surface renders the full strip. On the papers surface the import dialog is
 * owned by `PaperWorkspaceView` so it stays visible on non-reader views.
 */
export function usePaperSurfaceSlots(props: {
  workspaceRoot: string
  paperReading: WritePaperReadingSettingsV1
  activeFilePath: string | null
  surface: WriteWorkSurface
  input: string
  setInput: (value: string) => void
  onSubmitPrompt?: (value: string) => void
  t: TFunction
}): {
  paperBar: ReactElement | null
  paperDialog: ReactElement | null
  openPaperImport: () => void
} {
  const { workspaceRoot, paperReading, activeFilePath, surface, input, setInput, onSubmitPrompt, t } = props
  const paper = useWritePaperMode(workspaceRoot)
  const paperImportOpen = usePaperStore((s) => s.importOpen)
  const setPaperImportOpen = usePaperStore((s) => s.setImportOpen)

  const paperBar = surface === 'papers' ? (
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
  ) : paper.unitDir ? (
    <div className="flex items-center gap-2 border-b border-ds-border-muted bg-ds-subtle/40 px-3 py-1.5">
      <GraduationCap className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ds-muted">
        {t('writePaperModeOpenHint')}
      </span>
      <button
        type="button"
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/[0.08] px-2.5 text-[12px] font-medium text-accent transition hover:bg-accent/15"
        onClick={() => void enterPaperMode()}
      >
        <GraduationCap className="h-3.5 w-3.5" strokeWidth={1.9} />
        {t('writePaperModeEnter')}
      </button>
    </div>
  ) : null

  const paperDialog = surface === 'docs' && paperImportOpen ? (
    <PaperImportDialog
      workspaceRoot={workspaceRoot}
      papersDir={paperReading.papersDir || 'papers'}
      onClose={() => setPaperImportOpen(false)}
    />
  ) : null

  return {
    paperBar,
    paperDialog,
    openPaperImport: () => setPaperImportOpen(true)
  }
}
