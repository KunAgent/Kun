import type { NormalizedThread, ThreadDetail } from '../agent/types'
import { getProvider } from '../agent/registry'
import { threadLooksRunning } from './chat-store-runtime-helpers'
import {
  buildPrefetchedThreadSnapshot,
  cacheThreadSnapshot,
  captureThreadSnapshotCacheToken,
  getThreadSnapshot,
  threadSnapshotCacheTokenIsCurrent,
  threadSnapshotFingerprint,
  type ThreadSnapshotCacheToken
} from './thread-snapshot-cache'
import {
  hasForegroundThreadRecovery,
  onThreadRecoveryActivity
} from './thread-recovery-coordinator'

export const THREAD_DETAIL_PREWARM_CONCURRENCY = 2
export const THREAD_DETAIL_PREWARM_FAILURE_BACKOFF_MS = 30_000
export const THREAD_DETAIL_PREWARM_DWELL_MS = 250
export const THREAD_DETAIL_PREWARM_MAX_QUEUE = 4

type PrewarmJob = {
  thread: NormalizedThread
  fingerprint: string
}

type InFlightPrewarm = {
  fingerprint: string
  token: ThreadSnapshotCacheToken
  promise: Promise<ThreadDetail>
  managerGeneration: number
  controller: AbortController
  job: PrewarmJob
}

let queue: PrewarmJob[] = []
const inFlight = new Map<string, InFlightPrewarm>()
const retryAfterByThread = new Map<string, number>()
let activeBackgroundRequests = 0
let managerGeneration = 0
const dwellTimers = new Map<string, ReturnType<typeof setTimeout>>()
let recoveryActivityUnsubscribe: (() => void) | undefined

function ensureRecoveryObserver(): void {
  if (recoveryActivityUnsubscribe) return
  recoveryActivityUnsubscribe = onThreadRecoveryActivity(() => {
    if (hasForegroundThreadRecovery()) {
      for (const entry of inFlight.values()) {
        entry.controller.abort(new Error('prewarm superseded by foreground recovery'))
      }
      return
    }
    pumpQueue()
  })
}

function threadCanPrewarm(thread: NormalizedThread): boolean {
  return thread.archived !== true &&
    thread.relation !== 'side' &&
    !threadLooksRunning(thread)
}

function matchingInFlight(thread: NormalizedThread): InFlightPrewarm | null {
  const entry = inFlight.get(thread.id)
  if (!entry) return null
  if (entry.fingerprint !== threadSnapshotFingerprint(thread)) return null
  if (!threadSnapshotCacheTokenIsCurrent(thread.id, entry.token)) return null
  return entry
}

export type ThreadPrewarmHandle = {
  threadId: string
  promise: Promise<ThreadDetail>
  fingerprint: string
  token: ThreadSnapshotCacheToken
}

export function getThreadPrewarmHandle(thread: NormalizedThread): ThreadPrewarmHandle | null {
  const entry = matchingInFlight(thread)
  if (!entry) return null
  return {
    threadId: thread.id,
    promise: entry.promise,
    fingerprint: entry.fingerprint,
    token: entry.token
  }
}

/**
 * Re-validate a prewarm handle after its promise settles. The handle is only
 * authoritative while the thread's fingerprint is unchanged and its snapshot
 * cache token is still current; otherwise the caller must refetch the detail.
 */
export function threadPrewarmHandleIsCurrent(
  handle: ThreadPrewarmHandle,
  thread: NormalizedThread | null
): boolean {
  return thread != null &&
    thread.id === handle.threadId &&
    threadSnapshotFingerprint(thread) === handle.fingerprint &&
    threadSnapshotCacheTokenIsCurrent(handle.threadId, handle.token)
}

function startBackgroundPrewarm(job: PrewarmJob): void {
  if (hasForegroundThreadRecovery()) {
    enqueueJob(job)
    return
  }
  const existing = matchingInFlight(job.thread)
  if (existing) return
  const token = captureThreadSnapshotCacheToken(job.thread.id)
  const generation = managerGeneration
  const controller = new AbortController()
  let promise: Promise<ThreadDetail>
  try {
    promise = Promise.resolve(getProvider().getThreadDetail(job.thread.id, {
      signal: controller.signal,
      priority: 'background'
    }))
  } catch {
    retryAfterByThread.set(
      job.thread.id,
      Date.now() + THREAD_DETAIL_PREWARM_FAILURE_BACKOFF_MS
    )
    return
  }
  const entry: InFlightPrewarm = {
    fingerprint: job.fingerprint,
    token,
    promise,
    managerGeneration: generation,
    controller,
    job
  }
  inFlight.set(job.thread.id, entry)
  activeBackgroundRequests += 1
  void promise
    .then((detail) => {
      if (
        entry.managerGeneration !== managerGeneration ||
        inFlight.get(job.thread.id) !== entry
      ) return
      const snapshot = buildPrefetchedThreadSnapshot(job.thread, detail)
      const cached = snapshot ? cacheThreadSnapshot(snapshot, token) : false
      if (cached) {
        retryAfterByThread.delete(job.thread.id)
      } else {
        retryAfterByThread.set(
          job.thread.id,
          Date.now() + THREAD_DETAIL_PREWARM_FAILURE_BACKOFF_MS
        )
      }
    })
    .catch(() => {
      if (
        entry.managerGeneration !== managerGeneration ||
        inFlight.get(job.thread.id) !== entry
      ) return
      if (controller.signal.aborted) {
        if (hasForegroundThreadRecovery()) enqueueJob(job)
      } else retryAfterByThread.set(
        job.thread.id,
        Date.now() + THREAD_DETAIL_PREWARM_FAILURE_BACKOFF_MS
      )
    })
    .finally(() => {
      if (inFlight.get(job.thread.id) === entry) inFlight.delete(job.thread.id)
      if (entry.managerGeneration !== managerGeneration) return
      activeBackgroundRequests = Math.max(0, activeBackgroundRequests - 1)
      pumpQueue()
    })
}

function pumpQueue(): void {
  if (hasForegroundThreadRecovery()) return
  while (
    activeBackgroundRequests < THREAD_DETAIL_PREWARM_CONCURRENCY &&
    queue.length > 0
  ) {
    const job = queue.shift()!
    if (getThreadSnapshot(job.thread.id, job.fingerprint)) continue
    if (matchingInFlight(job.thread)) continue
    startBackgroundPrewarm(job)
  }
}

function enqueueJob(job: PrewarmJob): void {
  queue = queue.filter((candidate) => candidate.thread.id !== job.thread.id)
  queue.unshift(job)
  if (queue.length > THREAD_DETAIL_PREWARM_MAX_QUEUE) {
    queue.length = THREAD_DETAIL_PREWARM_MAX_QUEUE
  }
}

export function requestThreadPrewarm(
  thread: NormalizedThread,
  options: { dwell?: boolean } = {}
): void {
  ensureRecoveryObserver()
  if (
    !threadCanPrewarm(thread)
  ) return
  if ((retryAfterByThread.get(thread.id) ?? 0) > Date.now()) return
  const fingerprint = threadSnapshotFingerprint(thread)
  if (getThreadSnapshot(thread.id, fingerprint) || matchingInFlight(thread) || dwellTimers.has(thread.id)) return
  const job = { thread, fingerprint }
  if (options.dwell !== true) {
    enqueueJob(job)
    pumpQueue()
    return
  }
  const timer = setTimeout(() => {
    dwellTimers.delete(thread.id)
    if (!threadCanPrewarm(thread)) return
    enqueueJob(job)
    pumpQueue()
  }, THREAD_DETAIL_PREWARM_DWELL_MS)
  dwellTimers.set(thread.id, timer)
}

export function cancelThreadPrewarm(threadId: string): void {
  const timer = dwellTimers.get(threadId)
  if (timer) clearTimeout(timer)
  dwellTimers.delete(threadId)
  queue = queue.filter((job) => job.thread.id !== threadId)
  inFlight.get(threadId)?.controller.abort(new Error('prewarm hover cancelled'))
}

/** Test-only visibility into the bounded background coordinator. */
export function threadPrewarmStats(): {
  queued: number
  inFlight: number
  active: number
} {
  return {
    queued: queue.length,
    inFlight: inFlight.size,
    active: activeBackgroundRequests
  }
}

/** Test-only reset; product code relies on fingerprint/generation invalidation. */
export function resetThreadPrewarmState(): void {
  managerGeneration += 1
  for (const timer of dwellTimers.values()) clearTimeout(timer)
  dwellTimers.clear()
  for (const entry of inFlight.values()) {
    entry.controller.abort(new Error('prewarm state reset'))
  }
  queue = []
  inFlight.clear()
  retryAfterByThread.clear()
  activeBackgroundRequests = 0
  recoveryActivityUnsubscribe?.()
  recoveryActivityUnsubscribe = undefined
}
