import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { LibraryArtifact } from './artifact-types'
import { useDataReportFile } from './data-report-file'
import { DataReportView } from './DataReportView'
import { StageMessage } from './ArtifactViewerStages'

/** Artifacts viewer for a saved data report: the full report on one scrolling page. */
export function DataReportStage({ artifact }: { artifact: LibraryArtifact }): ReactElement {
  const { t } = useTranslation('common')
  const file = useDataReportFile({ workspaceRoot: artifact.workspaceRoot, path: artifact.path, version: artifact.updatedAt })
  if (file.status === 'loading') {
    return <StageMessage><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t('artifactsPreviewLoading')}</StageMessage>
  }
  if (file.status === 'error') return <StageMessage>{t('reportCardLoadFailed')}</StageMessage>
  const { report } = file
  const meta = [
    report.asOf ? t('reportCardAsOf', { time: report.asOf }) : '',
    report.revision > 1 ? t('reportCardRevision', { n: report.revision }) : ''
  ].filter(Boolean).join(' · ')
  return (
    <div className="h-full min-h-0 overflow-auto p-6" data-artifact-stage="report">
      <article className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 rounded-[18px] border border-ds-border bg-ds-card px-8 py-7 shadow-[0_16px_40px_rgba(24,24,27,0.06)]">
        <header>
          <h2 className="text-[24px] font-bold text-ds-ink">{report.title}</h2>
          {report.subtitle ? <p className="mt-1.5 text-[13.5px] leading-6 text-ds-muted">{report.subtitle}</p> : null}
          {meta ? <p className="mt-1 text-[12.5px] text-ds-faint">{meta}</p> : null}
        </header>
        <DataReportView report={report} variant="page" />
        {report.sources?.length ? (
          <footer className="border-t border-ds-border-muted pt-3 text-[12.5px] text-ds-muted">
            {t('reportCardSources', { sources: report.sources.join(' · ') })}
          </footer>
        ) : null}
      </article>
    </div>
  )
}
