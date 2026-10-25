import type { ActivityRow } from '@shared/activity-row'
import { displayBucket, type ActivityDisplayBucket } from '@shared/activity-display'
import type {
  AdeDispatchRecord,
  AdeQuestionRecord,
  AdeTeamOverview,
  AdeTeamWorker
} from '@shared/ade-teams'
import { workerStatus } from './worker-presentation'

/**
 * One Workers-panel row: the durable team worker merged with its
 * latest dispatch (diff stats, verdict) and the live activity row
 * (status bucket, waiting reason, progress note).
 */
export type WorkerRowData = {
  workerId: string
  label: string
  role?: string
  harnessId?: string
  model?: string
  state: AdeTeamWorker['state']
  control: AdeTeamWorker['control']
  /** True for ephemeral cross-review workers. */
  reviewer: boolean
  bucket: ActivityDisplayBucket
  /** Live activity row when one exists — StatusDot renders it directly. */
  activityRow?: ActivityRow
  waitingReason?: ActivityRow['waitingReason']
  progressNote?: string
  lastMessagePreview?: string
  dispatchState?: AdeDispatchRecord['state']
  dispatchTitle?: string
  diffStats?: { changedFiles: number; insertions: number; deletions: number }
  verdict?: AdeDispatchRecord['verdict']
  /** Latest still-open question this worker is waiting on. */
  openQuestion?: AdeQuestionRecord
  /** Tokens this worker's thread used, from the team usage rollup. */
  totalTokens?: number
  /**
   * A child agent of the thread that is not a team member (a delegated
   * subagent, a PPT child): no team controls; open and stop act on its thread.
   */
  child?: { threadId: string; turnId?: string }
}

function latestDispatchPerWorker(
  dispatches: AdeDispatchRecord[]
): Map<string, AdeDispatchRecord> {
  const latest = new Map<string, AdeDispatchRecord>()
  for (const dispatch of dispatches) {
    const current = latest.get(dispatch.workerId)
    if (!current || Date.parse(dispatch.updatedAt) >= Date.parse(current.updatedAt)) {
      latest.set(dispatch.workerId, dispatch)
    }
  }
  return latest
}

function latestOpenQuestionPerWorker(
  questions: AdeQuestionRecord[]
): Map<string, AdeQuestionRecord> {
  const open = new Map<string, AdeQuestionRecord>()
  for (const question of questions) {
    if (question.state !== 'open' && question.state !== 'escalated') continue
    const current = open.get(question.workerId)
    if (!current || Date.parse(question.updatedAt) >= Date.parse(current.updatedAt)) {
      open.set(question.workerId, question)
    }
  }
  return open
}

/**
 * Merge the team overview with the activity rows that belong to the
 * manager thread (`parentThreadId === managerThreadId`, `unitId === workerId`).
 * Workers with no activity row fall back to a state-derived bucket.
 */
export function mergeWorkerRows(
  overview: AdeTeamOverview,
  activityRows: ActivityRow[],
  now: number = Date.now()
): WorkerRowData[] {
  const dispatches = latestDispatchPerWorker(overview.dispatches)
  const questions = latestOpenQuestionPerWorker(overview.questions)
  const activityByUnit = new Map(activityRows.map((row) => [row.unitId, row]))
  const tokensByWorker = new Map(overview.usage?.perWorker.map((entry) => [entry.workerId, entry.totalTokens]) ?? [])
  return overview.team.workers.map((worker) => {
    const row = activityByUnit.get(worker.workerId)
    const dispatch = dispatches.get(worker.workerId)
    const fallback: ActivityDisplayBucket =
      worker.state !== 'active'
        ? 'done'
        : row
          ? displayBucket(row, now)
          : dispatch?.state === 'failed'
            ? 'needs-you'
            : dispatch?.state === 'completed' || dispatch?.state === 'accepted'
              ? 'done'
              : 'working'
    return {
      workerId: worker.workerId,
      label: worker.label,
      ...(worker.role ? { role: worker.role } : {}),
      ...(worker.route?.harnessId ? { harnessId: worker.route.harnessId } : {}),
      ...(worker.route?.model ? { model: worker.route.model } : {}),
      state: worker.state,
      control: worker.control,
      reviewer: Boolean(worker.reviewOf),
      bucket: row ? displayBucket(row, now) : fallback,
      ...(row ? { activityRow: row } : {}),
      ...(row?.waitingReason ? { waitingReason: row.waitingReason } : {}),
      ...(row?.progressNote ? { progressNote: row.progressNote } : {}),
      ...(row?.lastMessagePreview ? { lastMessagePreview: row.lastMessagePreview } : {}),
      ...(dispatch ? { dispatchState: dispatch.state, dispatchTitle: dispatch.title } : {}),
      ...(dispatch?.capture
        ? {
            diffStats: {
              changedFiles: dispatch.capture.changedFiles,
              insertions: dispatch.capture.insertions,
              deletions: dispatch.capture.deletions
            }
          }
        : {}),
      ...(dispatch?.verdict ? { verdict: dispatch.verdict } : {}),
      ...(questions.has(worker.workerId) ? { openQuestion: questions.get(worker.workerId) } : {}),
      ...(tokensByWorker.has(worker.workerId) ? { totalTokens: tokensByWorker.get(worker.workerId) } : {})
    }
  })
}

/**
 * Worker activity rows the team overview does not cover: child agents the
 * thread delegated to without a team. The composer's Workers pill counts
 * them, so the panel lists them too. Without a team, every row is one.
 */
export function childAgentRows(
  activityRows: ActivityRow[],
  teamWorkerIds: ReadonlySet<string>,
  now: number = Date.now()
): WorkerRowData[] {
  return activityRows
    .filter((row) => row.visibility !== 'archived' && !teamWorkerIds.has(row.unitId))
    .map((row) => {
      const bucket = displayBucket(row, now)
      const running = bucket === 'working' || bucket === 'needs-you' || bucket === 'review'
      return {
        workerId: row.unitId,
        label: row.title.trim() || row.unitId,
        ...(row.harnessId && row.harnessId !== 'kun' ? { harnessId: row.harnessId } : {}),
        state: running ? 'active' as const : 'released' as const,
        control: 'manager' as const,
        reviewer: false,
        bucket,
        activityRow: row,
        ...(row.waitingReason ? { waitingReason: row.waitingReason } : {}),
        ...(row.progressNote ? { progressNote: row.progressNote } : {}),
        ...(row.lastMessagePreview ? { lastMessagePreview: row.lastMessagePreview } : {}),
        child: { threadId: row.threadId, ...(row.turnId ? { turnId: row.turnId } : {}) }
      }
    })
}

/**
 * Panel header summary: running / waiting / done / failed, counted with the
 * same status rule the rows display, so the bar always matches the list.
 */
export function summarizeWorkerRows(rows: WorkerRowData[]): {
  running: number
  waiting: number
  done: number
  failed: number
  total: number
} {
  const summary = { running: 0, waiting: 0, done: 0, failed: 0, total: rows.length }
  for (const row of rows) {
    const { tone } = workerStatus(row)
    if (tone === 'running') summary.running += 1
    else if (tone === 'warning') summary.waiting += 1
    else if (tone === 'danger') summary.failed += 1
    else summary.done += 1
  }
  return summary
}

/**
 * Composer track pill: `Workers N` counts workers still in flight
 * (working or waiting on the manager thread); `waitingQuestions` drives the
 * amber `Workers · N 待回答` variant.
 */
export function workersPillState(
  workerRows: ActivityRow[],
  now: number = Date.now()
): {
  active: number
  waitingQuestions: number
} {
  let active = 0
  let waitingQuestions = 0
  for (const row of workerRows) {
    if (row.visibility === 'archived') continue
    const bucket = displayBucket(row, now)
    if (bucket === 'working' || bucket === 'needs-you' || bucket === 'review') {
      active += 1
      if (row.waitingReason === 'question' || row.waitingReason === 'user_input') {
        waitingQuestions += 1
      }
    }
  }
  return { active, waitingQuestions }
}
