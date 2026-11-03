import { useEffect, useRef, useState, type ReactElement } from 'react'
import { AlertTriangle, ArrowUpRight, Workflow, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GraphChildRuntime, GraphPlanningDraftView, GraphRun } from '../../graph/graph-types'
import { TrayButton, TraySegmentContent, TraySheetHeader } from './composer-tray/tray-primitives'
import type { ComposerGraphProgress } from './composer-graph-preview'
import { FloatingComposerGraphPreview, type GraphOpenChildHandler } from './FloatingComposerGraphPreview'
import './composer-tray/graph-tray.css'

/*
 * Graph progress in the composer activity tray (Graph board): the segment
 * content ("Graph · 前端表单、后端接口 ▬ 1/5"), the expanded sheet (header,
 * node map, inspector), and the planning-correction variant shown while a
 * plan draft waits for the user. The kind hook lives in
 * ./composer-tray/graph-tray-kind.tsx; the tray owns the segment button.
 */

export { FloatingComposerGraphPreview } from './FloatingComposerGraphPreview'

const MAX_SHOWN_ISSUES = 3

/** Segment content: workflow icon · label · 44px accepted track · "c/t". */
export function GraphProgressSegment({
  label,
  accepted,
  total,
  fraction,
  waiting = false,
  compact = false
}: {
  label: string
  accepted: number
  total: number
  fraction: number
  /** A node needs the user (asking, flagged, gone quiet): amber label and track. */
  waiting?: boolean
  compact?: boolean
}): ReactElement {
  const percent = Math.round(Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0)) * 100)
  return (
    <TraySegmentContent
      icon={<Workflow className="h-3.5 w-3.5" strokeWidth={2} />}
      label={label}
      tone={waiting ? 'waiting' : undefined}
      compact={compact}
      trailing={(
        <>
          {compact ? null : (
            <span className="ds-graph-tray-track" data-tone={waiting ? 'waiting' : undefined} aria-hidden="true">
              <span className="ds-graph-tray-track-fill" style={{ width: `${percent}%` }} />
            </span>
          )}
          <span className="ds-composer-tray-count" data-graph-progress-count>{`${accepted}/${total}`}</span>
        </>
      )}
    />
  )
}

/** Correction segment: amber "计划需要你的补充". */
export function GraphCorrectionSegment({ compact = false }: { compact?: boolean }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <TraySegmentContent
      icon={<AlertTriangle className="ds-graph-tray-warning-icon h-3.5 w-3.5" strokeWidth={2} />}
      label={t('graphPlanningStatus_needs_correction')}
      tone="waiting"
      compact={compact}
    />
  )
}

function currentPlanTitle(run: GraphRun): string | undefined {
  return (run.plans.find((plan) => plan.revision === run.currentRevision) ?? run.plans.at(-1))?.title
}

/** Expanded sheet: "Graph 编排 · 已验收 c / t 个节点 · n 个运行中", the node map, the inspector. */
export function GraphProgressSheet({
  run,
  progress,
  childRuns,
  onOpenGraph,
  onOpenChild,
  onClose
}: {
  run: GraphRun
  progress: ComposerGraphProgress
  childRuns: Readonly<Record<string, GraphChildRuntime>>
  onOpenGraph?: (runId: string, nodeId?: string) => void
  onOpenChild?: GraphOpenChildHandler
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const summary = [
    t('composerTrayGraph.acceptedSummary', { accepted: progress.completed, total: progress.total }),
    progress.activeCount > 0
      ? t('composerTrayGraph.runningSummary', { count: progress.activeCount })
      : null,
    run.status !== 'running' ? t(`graphStatus_${run.status}`, { defaultValue: run.status }) : null
  ].filter(Boolean).join(' · ')
  // Leaving for the full Graph (or a child session) folds the sheet first.
  const openGraph = (runId: string, nodeId?: string): void => {
    if (!onOpenGraph) return
    onClose()
    onOpenGraph(runId, nodeId)
  }
  const openChild: GraphOpenChildHandler | undefined = onOpenChild
    ? (runId, nodeId, attemptId, childThreadId) => {
        onClose()
        onOpenChild(runId, nodeId, attemptId, childThreadId)
      }
    : undefined
  return (
    <div data-graph-tray-sheet={run.id}>
      <TraySheetHeader
        title={<span title={currentPlanTitle(run)}>{t('composerTrayGraph.sheetTitle')}</span>}
        summary={summary}
        actions={onOpenGraph ? (
          <TrayButton
            data-graph-open-full
            trailingIcon={<ArrowUpRight className="h-3 w-3" strokeWidth={2} aria-hidden="true" />}
            onClick={() => openGraph(run.id)}
          >
            {t('graphComposerOpenFull')}
          </TrayButton>
        ) : null}
        onCollapse={onClose}
      />
      <FloatingComposerGraphPreview
        run={run}
        childRuns={childRuns}
        initialNodeId={progress.currentNodeId}
        onOpenGraph={openGraph}
        onOpenChild={openChild}
      />
    </div>
  )
}

type CorrectionAction = 'resume' | 'cancel'

/**
 * Planning paused on a draft that needs the user: the validation issues
 * (path, message, repair hint) and 取消 / 继续规划. Both buttons stay
 * disabled while either request is in flight; when the draft leaves
 * `needs_correction` the kind changes and the tray closes this sheet.
 */
export function GraphPlanningCorrectionSheet({
  correction,
  onResume,
  onCancel,
  onClose
}: {
  correction: GraphPlanningDraftView
  onResume: (draftId: string) => Promise<void> | void
  onCancel: (draftId: string) => Promise<void> | void
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [pending, setPending] = useState<CorrectionAction | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const draftId = correction.draft.id
  const issues = correction.draft.issues
  const shown = issues.slice(0, MAX_SHOWN_ISSUES)
  const perform = (action: CorrectionAction): void => {
    if (pending) return
    setPending(action)
    void Promise.resolve()
      .then(() => (action === 'resume' ? onResume(draftId) : onCancel(draftId)))
      .catch(() => undefined)
      .finally(() => {
        if (mountedRef.current) setPending(null)
      })
  }
  return (
    <div data-graph-planning-correction-sheet={draftId}>
      <TraySheetHeader
        title={t('composerTrayGraph.sheetTitle')}
        summary={t('graphPlanningStatus_needs_correction')}
        onCollapse={onClose}
      />
      {shown.length > 0 ? (
        <div className="ds-graph-tray-issues" role="list">
          {shown.map((issue, index) => (
            <div
              key={`${issue.code}-${index}`}
              className="ds-graph-tray-issue"
              role="listitem"
              data-graph-planning-issue={index}
            >
              <span className="ds-graph-tray-issue-icon">
                <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="ds-graph-tray-issue-body">
                <span className="ds-graph-tray-issue-message">{issue.message}</span>
                {issue.path.length > 0 ? (
                  <code className="ds-graph-tray-issue-path font-mono">{issue.path.join('.')}</code>
                ) : null}
                {issue.repairHint ? <span className="ds-graph-tray-issue-hint">{issue.repairHint}</span> : null}
              </span>
            </div>
          ))}
          {issues.length > shown.length ? (
            <span className="ds-graph-tray-issue-more">
              {t('composerTrayGraph.correctionMore', { count: issues.length - shown.length })}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="ds-graph-tray-correction-footer">
        <span className="ds-graph-tray-correction-note">{t('composerTrayGraph.correctionNote')}</span>
        <span className="ds-graph-tray-correction-actions">
          <TrayButton
            data-graph-planning-cancel
            icon={<X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
            disabled={pending != null}
            onClick={() => perform('cancel')}
          >
            {t('graphPlanningCancel')}
          </TrayButton>
          <TrayButton
            variant="solid"
            data-graph-planning-resume
            disabled={pending != null}
            aria-busy={pending === 'resume' || undefined}
            onClick={() => perform('resume')}
          >
            {t('graphPlanningContinue')}
          </TrayButton>
        </span>
      </div>
    </div>
  )
}
