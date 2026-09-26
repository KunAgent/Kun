import type { ActivityRow } from '@shared/activity-row'
import { displayBucket, type ActivityDisplayBucket } from '@shared/activity-display'
import type {
  AdeDispatchRecord,
  AdeQuestionRecord,
  AdeTeamOverview,
  AdeTeamWorker
} from '@shared/ade-teams'

/**
 * One Workers-panel row (12 §6.1): the durable team worker merged with its
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
  /** True for ephemeral cross-review workers (10 §5). */
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
      ...(questions.has(worker.workerId) ? { openQuestion: questions.get(worker.workerId) } : {})
    }
  })
}

/** Panel header summary (12 §6.1): running / waiting / done / failed. */
export function summarizeWorkerRows(rows: WorkerRowData[]): {
  running: number
  waiting: number
  done: number
  failed: number
  total: number
} {
  const summary = { running: 0, waiting: 0, done: 0, failed: 0, total: rows.length }
  for (const row of rows) {
    if (row.bucket === 'working') summary.running += 1
    else if (row.bucket === 'needs-you') {
      if (row.dispatchState === 'failed' || row.state !== 'active') summary.failed += 1
      else summary.waiting += 1
    } else if (row.bucket === 'done' || row.bucket === 'review' || row.bucket === 'idle') {
      summary.done += 1
    }
  }
  return summary
}

/**
 * Composer track pill (12 §6.1): `Workers N` counts workers still in flight
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
