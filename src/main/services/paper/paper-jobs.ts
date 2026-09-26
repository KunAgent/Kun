/**
 * Long-running paper jobs (import / cool-notes / preprocess) keyed by the
 * caller-provided requestId. Progress fans out to the invoking renderer over
 * `paper:progress`; cancel aborts the job's AbortSignal.
 */
import type { WebContents } from 'electron'
import type { PaperJobKind, PaperProgressEvent } from '../../../shared/paper/paper-types'

export const PAPER_PROGRESS_CHANNEL = 'paper:progress'

type PaperJob = {
  requestId: string
  kind: PaperJobKind
  controller: AbortController
  sender: WebContents
  startedAt: number
}

const jobs = new Map<string, PaperJob>()

export function beginPaperJob(
  requestId: string,
  kind: PaperJobKind,
  sender: WebContents
): { signal: AbortSignal; progress: (stage: string, message?: string) => void } {
  // A reused requestId supersedes the earlier job.
  jobs.get(requestId)?.controller.abort()
  const controller = new AbortController()
  const job: PaperJob = { requestId, kind, controller, sender, startedAt: Date.now() }
  jobs.set(requestId, job)
  const progress = (stage: string, message?: string) => {
    emitPaperProgress(job, stage, 'running', message)
  }
  return { signal: controller.signal, progress }
}

export function emitPaperProgress(
  job: PaperJob,
  stage: string,
  status: PaperProgressEvent['status'],
  message?: string
): void {
  if (job.sender.isDestroyed()) return
  const event: PaperProgressEvent = {
    requestId: job.requestId,
    kind: job.kind,
    stage,
    status,
    message,
    elapsedMs: Date.now() - job.startedAt
  }
  job.sender.send(PAPER_PROGRESS_CHANNEL, event)
}

export function finishPaperJob(
  requestId: string,
  status: 'done' | 'error' | 'canceled',
  message?: string
): void {
  const job = jobs.get(requestId)
  if (!job) return
  emitPaperProgress(job, 'job', status, message)
  jobs.delete(requestId)
}

export function cancelPaperJob(requestId: string): boolean {
  const job = jobs.get(requestId)
  if (!job) return false
  job.controller.abort()
  return true
}

export function isPaperJobCanceled(signal: AbortSignal, error?: unknown): boolean {
  if (signal.aborted) return true
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'canceled')
}
