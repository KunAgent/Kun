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

const jobs = new Map<WebContents, Map<string, PaperJob>>()
const observedSenders = new WeakSet<WebContents>()

function ownedJobs(sender: WebContents): Map<string, PaperJob> {
  let owned = jobs.get(sender)
  if (!owned) {
    owned = new Map()
    jobs.set(sender, owned)
  }
  if (!observedSenders.has(sender)) {
    observedSenders.add(sender)
    sender.once('destroyed', () => {
      for (const job of jobs.get(sender)?.values() ?? []) job.controller.abort()
      jobs.delete(sender)
    })
  }
  return owned
}

export function beginPaperJob(
  requestId: string,
  kind: PaperJobKind,
  sender: WebContents
): { signal: AbortSignal; progress: (stage: string, message?: string) => void } {
  const owned = ownedJobs(sender)
  // Reuse only supersedes work belonging to this sender, never another client.
  owned.get(requestId)?.controller.abort()
  const controller = new AbortController()
  const job: PaperJob = { requestId, kind, controller, sender, startedAt: Date.now() }
  owned.set(requestId, job)
  const progress = (stage: string, message?: string) => {
    if (owned.get(requestId) === job && !controller.signal.aborted) {
      emitPaperProgress(job, stage, 'running', message)
    }
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
  sender: WebContents,
  signal: AbortSignal,
  message?: string
): void {
  const owned = jobs.get(sender)
  const job = owned?.get(requestId)
  // A superseded job must not complete or delete its replacement.
  if (!job || job.controller.signal !== signal) return
  emitPaperProgress(job, 'job', status, message)
  owned?.delete(requestId)
  if (owned?.size === 0) jobs.delete(sender)
}

export function cancelPaperJob(requestId: string, sender: WebContents): boolean {
  const job = jobs.get(sender)?.get(requestId)
  if (!job) return false
  job.controller.abort()
  return true
}

export function isPaperJobCanceled(signal: AbortSignal, error?: unknown): boolean {
  if (signal.aborted) return true
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'canceled')
}
