import { ChevronRight } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TrajectoryDetailSection } from '../../agent/trajectory'
import type { HarnessCell, HarnessRequestBoundary } from './trajectory-harness-model'
import { trajectorySourceTypeLabel } from './trajectory-source-label'
import styles from './TrajectoryInspector.module.css'

export function TrajectoryInspectorSummary({
  cell,
  request,
  parentRequest,
  onSelectParentRequest,
  onSelectSection
}: {
  cell: HarnessCell | null
  request: HarnessRequestBoundary | null
  parentRequest: HarnessRequestBoundary | null
  onSelectParentRequest: (requestId: string) => void
  onSelectSection: (section: TrajectoryDetailSection) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const requestRecord = request?.request ?? parentRequest?.request
  const status = request?.request.status ?? cell?.status
  const usage = requestRecord?.usage
  return (
    <div className={styles.summary} data-trajectory-summary="">
      <dl className={styles.summaryRows}>
        {parentRequest ? (
          <SummaryRow label={t('trajectoryDetailHierarchy')}>
            <button
              type="button"
              className={styles.summaryLink}
              onClick={() => onSelectParentRequest(parentRequest.request.requestId)}
            >
              Request #{parentRequest.number}<ChevronRight />
            </button>
          </SummaryRow>
        ) : null}
        {status ? (
          <SummaryRow label={t('trajectoryDetailStatus')}>
            <span data-status={status}>{t(`trajectoryStatus_${status}`)}</span>
          </SummaryRow>
        ) : null}
        {request ? <SummaryRow label={t('trajectoryDetailProvider')}>{request.request.provider}</SummaryRow> : null}
        {request ? <SummaryRow label={t('trajectoryDetailModel')}>{request.request.model}</SummaryRow> : null}
        {request ? <SummaryRow label={t('trajectoryDetailAttempt')}>{request.request.attempt}</SummaryRow> : null}
        {cell?.record.kind === 'tool' || cell?.record.kind === 'subtool' ? (
          <>
            <SummaryRow label={t('trajectoryDetailTool')}>{cell.record.toolName}</SummaryRow>
            <SummaryRow label={t('trajectoryDetailCallId')}><code>{cell.record.callId}</code></SummaryRow>
          </>
        ) : null}
        {cell && (cell.kind === 'user' || cell.kind === 'context') &&
        ('sourceAvailable' in cell.record ? cell.record.sourceAvailable ?? true : true) ? (
          <SummaryRow label={t('trajectoryTabSource')}>
            <button type="button" className={styles.summaryLink} onClick={() => onSelectSection('source')}>
              {'sourceLabel' in cell.record
                ? trajectorySourceTypeLabel(cell.record.sourceType, t, cell.record.sourceLabel ?? t('trajectoryTabSource'))
                : t('trajectoryTabSource')}<ChevronRight />
            </button>
          </SummaryRow>
        ) : null}
        {cell?.durationMs !== null && cell?.durationMs !== undefined ? (
          <SummaryRow label={t('trajectoryDetailDuration')}>{formatDuration(cell.durationMs)}</SummaryRow>
        ) : null}
        {usage ? <SummaryRow label={t('trajectoryDetailInputTokens')}>{formatNumber(usage.promptTokens)}</SummaryRow> : null}
        {usage ? <SummaryRow label={t('trajectoryDetailOutputTokens')}>{formatNumber(usage.completionTokens)}</SummaryRow> : null}
        {usage?.reasoningTokens !== undefined ? (
          <SummaryRow label={t('trajectoryDetailReasoningTokens')}>{formatNumber(usage.reasoningTokens)}</SummaryRow>
        ) : null}
        {cell?.record.errorMessage ? (
          <SummaryRow label={t('trajectoryDetailError')}><span className={styles.summaryError}>{cell.record.errorMessage}</span></SummaryRow>
        ) : null}
      </dl>
      <div className={styles.summarySections}>
        {request ? (
          <>
            <SummarySection label={t('trajectorySection_usage')} onOpen={() => onSelectSection('usage')}>
              {usage
                ? `${formatNumber(usage.promptTokens)} → ${formatNumber(usage.completionTokens)}`
                : '—'}
            </SummarySection>
            <SummarySection label={t('trajectorySection_timing')} onOpen={() => onSelectSection('timing')}>
              {formatDuration(request.request.durationMs ?? 0)}
            </SummarySection>
          </>
        ) : null}
        {cell?.kind === 'assistant' || cell?.kind === 'user' || cell?.kind === 'context' ? (
          <SummarySection label={t('trajectoryTabPreview')} onOpen={() => onSelectSection('rendered')}>
            {cell.thinking ? <span className={styles.summaryThinking}>{cell.thinking}</span> : null}
            <span>{cell.text || '—'}</span>
          </SummarySection>
        ) : null}
        {cell?.kind === 'compacted' ? (
          <SummarySection label={t('trajectoryTabSummary')} onOpen={() => onSelectSection('raw')}>
            {cell.text || '—'}
          </SummarySection>
        ) : null}
        {cell?.record.kind === 'tool' || cell?.record.kind === 'subtool' ? (
          <>
            <SummarySection label={t('trajectoryTabPayload')} onOpen={() => onSelectSection('arguments')}>
              {cell.record.argumentPreview || '—'}
            </SummarySection>
            <SummarySection label={t('trajectorySection_result')} onOpen={() => onSelectSection('result')}>
              {cell.record.resultPreview || '—'}
            </SummarySection>
            <SummarySection label={t('trajectorySection_timing')} onOpen={() => onSelectSection('timing')}>
              {formatDuration(cell.durationMs ?? 0)}
            </SummarySection>
          </>
        ) : null}
      </div>
    </div>
  )
}

function SummaryRow({
  label,
  children
}: {
  label: string
  children: ReactNode
}): ReactElement {
  return <div><dt>{label}</dt><dd>{children}</dd></div>
}

function SummarySection({
  label,
  children,
  onOpen
}: {
  label: string
  children: ReactNode
  onOpen: () => void
}): ReactElement {
  return (
    <section className={styles.summarySection}>
      <button type="button" className={styles.summarySectionHeader} onClick={onOpen}>
        <span>{label}</span><ChevronRight />
      </button>
      <div className={styles.summarySectionBody}>{children}</div>
    </section>
  )
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${Math.round(value)} ms`
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`
}
