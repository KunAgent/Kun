import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import type { ActivityRow } from '@shared/activity-row'
import { useActivityStore } from '../../../store/activity-store'
import { selectWorkerRowsForParent } from '../../../store/activity-selectors'
import { selectSessionExecutionSummary } from '../../../store/session-execution-summary'
import { isDispatchManagerThread } from '../FloatingComposerDispatchableAgents'
import type { FloatingComposerRenderContext } from '../floating-composer-view-context'
import type { TrayKind, TrayTone } from './tray-kind'
import { TrayAvatar, TrayDot } from './tray-primitives'
import {
  buildWorkersTrayRows,
  workersAccessibleStatus,
  workersCountDetail,
  workersSegmentStatus,
  type WorkersSegmentStatus,
  type WorkersTrayRow
} from './workers-tray-model'
import { WorkersTraySheet } from './workers-tray-sheet'

const NO_ROWS: ActivityRow[] = []
const SEGMENT_AVATARS = 3

/**
 * A segment button's aria-label is never announced when it changes, so the
 * kind also carries its status as `liveStatus` for a polite live region
 * outside the segment buttons. TrayKind has no such slot yet; this field is
 * ready for the tray to render.
 */
type WorkersTrayKind = TrayKind & { liveStatus: string }

/** Segment chip content: up to three worker avatars, then the status label (or a tone dot in compact). */
function WorkersTraySegment({
  rows,
  status,
  title,
  open,
  compact,
  tone
}: {
  rows: readonly WorkersTrayRow[]
  status: WorkersSegmentStatus
  title: string
  open: boolean
  compact: boolean
  tone: TrayTone
}): ReactElement {
  const labelTone = status.labelTone === 'waiting' || status.labelTone === 'error' ? status.labelTone : undefined
  return (
    <>
      {/* Side by side, not stacked: each initial stays readable at 18px. */}
      <span className={`ds-composer-tray-segment-icon ${compact ? 'gap-[3px]' : 'gap-[5px]'}`} aria-hidden="true">
        {rows.slice(0, SEGMENT_AVATARS).map((row) => (
          <TrayAvatar key={row.id} label={row.glyph} color={row.color} />
        ))}
      </span>
      {compact ? <TrayDot tone={tone} /> : null}
      {!compact && open && !status.selfNamed ? <span className="ds-composer-tray-segment-label">{title}</span> : null}
      {!compact ? (
        <span
          className={`ds-composer-tray-segment-label tabular-nums ${
            status.labelTone === 'done' ? 'font-medium text-ds-status-success' : ''
          }`.trim()}
          data-tone={labelTone}
        >
          {status.label}
        </span>
      ) : null}
    </>
  )
}

/**
 * Collaborators segment and sheet (Workers board). The segment shows up to
 * three worker avatars and one status by priority: "1 个等你处理" (warning) >
 * "1 个失败" (danger) > "1 个待审查" > "2 位协作者在做" > "协作已完成"
 * (success); a stale feed or restored, unconfirmed rows read "状态待确认"
 * and the sheet explains why. The sheet lists every worker (see
 * workers-tray-sheet.tsx) and, on a manager session, the agents it can still
 * hand work to; the tray then hides the Dispatch segment.
 *
 * Visible only when the thread has worker activity rows the summary counts
 * (the old composer status strip's rule). Data: the activity store's worker
 * rows of the thread, compared element-wise so unrelated activity updates do
 * not re-render the tray, and selectSessionExecutionSummary with the main
 * turn's busy state. `data-background-task-strip` / `-unfinished` stay on the
 * segment button for tests and smoke scripts.
 */
export function useWorkersTrayKind(context: FloatingComposerRenderContext): TrayKind | null {
  const { t } = useTranslation('common')
  const threadId = typeof context.activeThreadId === 'string' && context.activeThreadId
    ? context.activeThreadId
    : null
  const workerRows = useActivityStore(useShallow((state) =>
    threadId ? selectWorkerRowsForParent(state.rows, threadId) : NO_ROWS))
  const feedError = useActivityStore((state) => state.status === 'error')
  const mainRunning = context.busy === true
  const dispatchEnabled = isDispatchManagerThread(context.activeThread, context.adeComposerEnabled === true)
  const openSettings: unknown = context.openSettings

  const model = useMemo(() => {
    // No background work: leave the composer exactly as it was.
    if (workerRows.length === 0) return null
    const now = Date.now()
    const summary = selectSessionExecutionSummary(workerRows, { now, feedError, mainRunning })
    if (summary.kind === 'none') return null
    return { summary, rows: buildWorkersTrayRows(workerRows, { now, feedError }) }
  }, [workerRows, feedError, mainRunning])

  return useMemo((): WorkersTrayKind | null => {
    if (!model) return null
    const { summary, rows } = model
    const status = workersSegmentStatus(summary, t)
    const unknown = summary.kind === 'unknown'
    const activity = unknown ? undefined : summary.activityTitle
    const detail = workersCountDetail(summary, t) || (unknown ? t('backgroundTaskUnknownHint') : '')
    const title = t('composerTrayWorkers.title')
    const accessibleStatus = workersAccessibleStatus(summary, status, t)
    return {
      id: 'workers',
      align: 'start',
      tone: status.tone,
      ariaLabel: accessibleStatus,
      liveStatus: accessibleStatus,
      title: [activity ? `${status.label} · ${activity}` : status.label, detail].filter(Boolean).join('\n'),
      segmentAttributes: {
        'data-background-task-strip': summary.kind,
        'data-background-task-unfinished': summary.unfinished
      },
      renderSegment: ({ open, compact }) => (
        <WorkersTraySegment rows={rows} status={status} title={title} open={open} compact={compact} tone={status.tone} />
      ),
      renderSheet: ({ close, compact }) => (
        <WorkersTraySheet
          rows={rows}
          compact={compact}
          unknown={unknown}
          dispatchEnabled={dispatchEnabled}
          openSettings={openSettings}
          onClose={close}
        />
      )
    }
  }, [model, dispatchEnabled, openSettings, t])
}
