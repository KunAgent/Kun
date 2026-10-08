import type { ReactElement } from 'react'
import { BookOpenText, FileText, LibraryBig, Table2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePaperBatchInterpret } from '../../paper/paper-batch-interpret'
import { usePaperImportJobs } from '../../paper/paper-import-job'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { openPaperViewTab } from '../../paper/paper-view'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'

/**
 * What to do with papers that were just imported: read them (batch
 * interpretation), compare them, write related work, or open the library.
 * Shown under the recommendation card once its import finished.
 */
export function PaperListNextSteps({ scope }: { scope: string }): ReactElement | null {
  const { t } = useTranslation('common')
  const job = usePaperImportJobs((s) => s.jobs[scope])
  if (!job || job.running || job.undone) return null
  const created = job.items.filter((item) => item.created && item.unitDir)
  if (created.length === 0) return null
  const titles = created.map((item) => `- ${item.title}`).join('\n')

  const ask = (promptKey: string): void => {
    const composer = usePaperModeStore.getState().composerBridge
    const text = t(promptKey, { titles })
    if (composer?.submit) composer.submit(text)
    else composer?.setInput(text)
  }
  const interpret = (): void => {
    const root = useWriteWorkspaceStore.getState().workspaceRoot
    const entries = usePaperModeStore.getState().entries
    const papers = created.flatMap((item) => {
      const entry = entries.find((candidate) => candidate.unitDir === item.unitDir)
      return entry ? [{ unitDir: entry.unitDir, meta: entry.meta }] : []
    })
    usePaperBatchInterpret.getState().openDialog(root, papers)
  }

  const chip = 'inline-flex h-7 items-center gap-1.5 rounded-full border border-ds-border bg-ds-main px-2.5 text-[12px] text-ds-ink transition hover:bg-ds-hover'
  return (
    <div className="mt-2.5">
      <p className="mb-1.5 text-[11.5px] text-ds-faint">{t('paperNextStepsTitle')}</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={interpret} className={chip}>
          <BookOpenText className="h-3.5 w-3.5 text-[var(--ds-accent)]" strokeWidth={1.8} />
          {t('paperNextInterpret', { count: created.length })}
        </button>
        <button type="button" onClick={() => ask('paperNextComparePrompt')} className={chip}>
          <Table2 className="h-3.5 w-3.5 text-[var(--ds-accent)]" strokeWidth={1.8} />
          {t('paperNextCompare')}
        </button>
        <button type="button" onClick={() => ask('paperNextRelatedPrompt')} className={chip}>
          <FileText className="h-3.5 w-3.5 text-[var(--ds-accent)]" strokeWidth={1.8} />
          {t('paperNextRelated')}
        </button>
        <button type="button" onClick={() => openPaperViewTab('library')} className={chip}>
          <LibraryBig className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} />
          {t('paperNextLibrary')}
        </button>
      </div>
    </div>
  )
}
