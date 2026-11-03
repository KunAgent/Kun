import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowUpRight, Check, ChartLine, Loader2, Maximize2 } from 'lucide-react'
import { summarizeDataReport } from '../../../../../kun/src/contracts/data-report'
import type { ToolBlock } from '../../agent/types'
import { readReportOpenRequest } from '../../agent/report-open-request'
import { useChatStore } from '../../store/chat-store'
import { artifactId, normalizeLibraryRoots } from '../../artifacts/artifact-index'
import { openLibraryArtifact } from '../../artifacts/artifact-library-store'
import { useDataReportFile } from '../../artifacts/data-report-file'
import { DataReportView } from '../../artifacts/DataReportView'

/** Long reports show this many blocks in the transcript until expanded. */
export const REPORT_CARD_COLLAPSED_BLOCKS = 3
const REPORT_CARD_COLLAPSE_AFTER = 4

export type ReportOpenCardState = 'building' | 'ready' | 'failed' | 'interrupted'

export function reportOpenCardState(status: 'pending' | 'ready' | 'failed', requestTurnLive: boolean): ReportOpenCardState {
  if (status === 'pending') return requestTurnLive ? 'building' : 'interrupted'
  return status
}

function CardIcon({ state }: { state: ReportOpenCardState }): ReactElement {
  if (state === 'building') return <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={1.9} aria-hidden />
  if (state === 'failed' || state === 'interrupted') return <AlertCircle className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden />
  return <ChartLine className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden />
}

function ReportSkeleton(): ReactElement {
  return (
    <div className="grid gap-3 p-4" aria-hidden>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((index) => <div key={index} className="h-[74px] rounded-[14px] bg-ds-subtle" />)}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="h-44 rounded-xl bg-ds-subtle" /><div className="h-44 rounded-xl bg-ds-subtle" />
      </div>
    </div>
  )
}

/**
 * Transcript card for a `report_open` call: the whole report rendered by Kun,
 * with the way into the Artifacts library where the saved copy lives.
 */
export function ReportOpenCard({ block, threadId, requestTurnLive }: {
  block: ToolBlock
  threadId?: string
  requestTurnLive: boolean
}): ReactElement | null {
  const { t } = useTranslation('common')
  const request = useMemo(() => readReportOpenRequest(block), [block])
  const workspace = useChatStore((state) => threadId
    ? state.threads.find((candidate) => candidate.id === threadId)?.workspace ?? ''
    : '')
  const root = normalizeLibraryRoots([workspace])[0] ?? ''
  const [expanded, setExpanded] = useState(false)
  // Transcripts from delegated harnesses may lack the arguments; read the saved file then.
  const fileTarget = request?.status === 'ready' && !request.report && root && request.relativePath
    ? { workspaceRoot: root, path: request.relativePath, version: request.updatedAt }
    : null
  const file = useDataReportFile(fileTarget)
  if (!request) return null

  const state = reportOpenCardState(request.status, requestTurnLive)
  const report = request.report ?? (file.status === 'ready' ? file.report : undefined)
  const summary = report ? summarizeDataReport(report) : null
  const canOpen = state === 'ready' && Boolean(root && request.relativePath)
  const open = (): void => {
    if (!canOpen || !request.relativePath) return
    openLibraryArtifact(artifactId('report', root, request.relativePath))
  }
  const meta = state === 'building'
    ? t('reportCardBuilding')
    : state === 'failed'
      ? t('reportCardFailed', { error: request.error ?? '' })
      : state === 'interrupted'
        ? t('reportCardInterrupted')
        : [
            t('artifactsKindReport'),
            summary?.stats ? t('reportCardStats', { n: summary.stats }) : '',
            summary?.charts ? t('reportCardCharts', { n: summary.charts }) : '',
            report?.asOf ? t('reportCardAsOf', { time: report.asOf }) : '',
            request.revision && request.revision > 1 ? t('reportCardRevision', { n: request.revision }) : ''
          ].filter(Boolean).join(' · ')
  const collapsible = Boolean(report && report.blocks.length > REPORT_CARD_COLLAPSE_AFTER)
  const hiddenBlocks = report && collapsible && !expanded ? report.blocks.length - REPORT_CARD_COLLAPSED_BLOCKS : 0
  const tile = state === 'failed' || state === 'interrupted'
    ? 'bg-ds-danger-soft text-ds-status-danger'
    : 'bg-accent-soft text-accent'

  return (
    <section
      aria-label={request.title}
      data-report-open-card
      data-report-open-state={state}
      className="ds-no-drag my-2 w-full min-w-0 overflow-hidden rounded-[18px] border border-ds-border bg-ds-card shadow-[0_1px_2px_rgba(24,24,27,0.04),0_8px_24px_rgba(24,24,27,0.05)]"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-ds-border-muted px-4 py-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${tile}`}><CardIcon state={state} /></span>
        <div className="min-w-0 flex-[1_1_200px]">
          <h3 className="truncate text-[15px] font-semibold text-ds-ink">{request.title}</h3>
          <p className="mt-0.5 truncate text-[12px] text-ds-muted" title={meta}>{meta}</p>
        </div>
        {state === 'ready' ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-ds-success-soft px-2.5 py-1 text-[11.5px] font-medium text-ds-status-success">
            <Check className="h-3 w-3" strokeWidth={2.4} aria-hidden />{t('reportCardSaved')}
          </span>
        ) : null}
        {canOpen ? (
          <button type="button" onClick={open} aria-label={t('reportCardOpen')} title={t('reportCardOpen')} data-report-open-open
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40">
            <Maximize2 className="h-4 w-4" strokeWidth={1.9} aria-hidden />
          </button>
        ) : null}
      </header>
      {report && state !== 'failed' ? (
        <div className="p-4">
          {report.subtitle ? <p className="mb-3 text-[12.5px] leading-5 text-ds-muted">{report.subtitle}</p> : null}
          <DataReportView report={report} limitBlocks={hiddenBlocks > 0 ? REPORT_CARD_COLLAPSED_BLOCKS : undefined} />
          {collapsible ? (
            <div className="mt-3 flex justify-center">
              <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}
                className="rounded-full border border-ds-border bg-ds-card px-4 py-1.5 text-[12.5px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
                {expanded ? t('reportCardShowLess') : t('reportCardShowMore', { n: hiddenBlocks })}
              </button>
            </div>
          ) : null}
        </div>
      ) : state === 'building' || (state === 'ready' && file.status === 'loading') ? (
        <ReportSkeleton />
      ) : state === 'ready' ? (
        <p className="px-4 py-3 text-[12.5px] text-ds-muted">{t('reportCardLoadFailed')}</p>
      ) : null}
      {state === 'ready' ? (
        <footer className="flex flex-wrap items-center gap-3 border-t border-ds-border-muted bg-ds-surface-subtle px-4 py-2.5 text-[12px] text-ds-muted">
          {report?.sources?.length ? (
            <span className="min-w-0 flex-1 truncate" title={report.sources.join(' · ')}>
              {t('reportCardSources', { sources: report.sources.join(' · ') })}
            </span>
          ) : <span className="flex-1" />}
          {canOpen ? (
            <button type="button" onClick={open}
              className="flex shrink-0 items-center gap-1 font-semibold text-accent hover:underline">
              {t('reportCardOpen')}<ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
            </button>
          ) : null}
        </footer>
      ) : null}
    </section>
  )
}
