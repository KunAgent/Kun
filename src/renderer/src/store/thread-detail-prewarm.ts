import type { NormalizedThread, ThreadDetail } from '../agent/types'
import { getProvider } from '../agent/registry'
import { threadLooksRunning } from './chat-store-runtime-helpers'
import {
  buildPrefetchedThreadSnapshot,
  cacheThreadSnapshot,
  captureThreadSnapshotCacheToken,
  getThreadSnapshot,
  invalidateThreadSnapshot,
  threadSnapshotCacheTokenIsCurrent,
  threadSnapshotFingerprint,
  type ThreadSnapshotCacheToken
} from './thread-snapshot-cache'

export const THREAD_DETAIL_PREWARM_LIMIT = 6
export const THREAD_DETAIL_PREWARM_CONCURRENCY = 2

type PrewarmPriority = 'recent' | 'intent'

type PrewarmJob = {
  thread: NormalizedThread
  fingerprint: string
  priority: PrewarmPriority
}

type InFlightPrewarm = {
  fingerprint: string
  token: ThreadSnapshotCacheToken
  promise: Promise<ThreadDetail>
  managerGeneration: number
}

type IdleHandle = {
  kind: 'idle' | 'timeout'
  id: number
}

let queue: PrewarmJob[] = []
const inFlight = new Map<string, InFlightPrewarm>()
let activeBackgroundRequests = 0
let scheduleGeneration = 0
let managerGeneration = 0
let idleHandle: IdleHandle | null = null

function threadUpdatedTime(thread: NormalizedThread): number {
  const parsed = Date.parse(thread.updatedAt)
  return Number.isFinite(parsed) ? parsed : 0
}

function threadCanPrewarm(thread: NormalizedThread): boolean {
  return thread.archived !== true &&
    thread.relation !== 'side' &&
    !threadLooksRunning(thread)
}

export function recentThreadPrewarmCandidates(
  threads: readonly NormalizedThread[],
  activeThreadId: string | null,
  limit = THREAD_DETAIL_PREWARM_LIMIT
): NormalizedThread[] {
  return threads
    .filter((thread) =>
      thread.id !== activeThreadId &&
      threadCanPrewarm(thread)
    )
    .sort((left, right) =>
      threadUpdatedTime(right) - threadUpdatedTime(left) || left.id.localeCompare(right.id)
    )
    .slice(0, Math.max(0, limit))
}

function cancelScheduledIdle(): void {
  if (!idleHandle || typeof window === 'undefined') return
  if (idleHandle.kind === 'idle') {
    const candidate = window as typeof window & { cancelIdleCallback?: (id: number) => void }
    candidate.cancelIdleCallback?.(idleHandle.id)
  } else {
    window.clearTimeout?.(idleHandle.id)
  }
  idleHandle = null
}

function scheduleIdle(callback: () => void): void {
  cancelScheduledIdle()
  if (typeof window === 'undefined') {
    callback()
    return
  }
  const candidate = window as typeof window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
  }
  if (typeof candidate.requestIdleCallback === 'function') {
    idleHandle = {
      kind: 'idle',
      id: candidate.requestIdleCallback(callback, { timeout: 1_000 })
    }
    return
  }
  if (typeof window.setTimeout !== 'function') {
    callback()
    return
  }
  idleHandle = { kind: 'timeout', id: window.setTimeout(callback, 0) }
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
  const existing = matchingInFlight(job.thread)
  if (existing) return
  const token = captureThreadSnapshotCacheToken(job.thread.id)
  const generation = managerGeneration
  let promise: Promise<ThreadDetail>
  try {
    promise = Promise.resolve(getProvider().getThreadDetail(job.thread.id))
  } catch {
    return
  }
  const entry: InFlightPrewarm = {
    fingerprint: job.fingerprint,
    token,
    promise,
    managerGeneration: generation
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
      if (snapshot) cacheThreadSnapshot(snapshot, token)
    })
    .catch(() => undefined)
    .finally(() => {
      if (inFlight.get(job.thread.id) === entry) inFlight.delete(job.thread.id)
      if (entry.managerGeneration !== managerGeneration) return
      activeBackgroundRequests = Math.max(0, activeBackgroundRequests - 1)
      pumpQueue()
    })
}

function pumpQueue(): void {
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

export function requestThreadPrewarm(
  thread: NormalizedThread,
  priority: PrewarmPriority = 'intent'
): void {
  if (
    !threadCanPrewarm(thread)
  ) return
  const fingerprint = threadSnapshotFingerprint(thread)
  if (getThreadSnapshot(thread.id, fingerprint) || matchingInFlight(thread)) return
  queue = queue.filter((job) => job.thread.id !== thread.id)
  const job = { thread, fingerprint, priority }
  if (priority === 'intent') queue.unshift(job)
  else queue.push(job)
  pumpQueue()
}

export function scheduleRecentThreadPrewarm(
  threads: readonly NormalizedThread[],
  activeThreadId: string | null
): void {
  scheduleGeneration += 1
  const generation = scheduleGeneration
  const currentThreads = new Map(threads.map((thread) => [thread.id, thread]))
  for (const [threadId, entry] of inFlight) {
    const current = currentThreads.get(threadId)
    if (
      !current ||
      !threadCanPrewarm(current) ||
      threadSnapshotFingerprint(current) !== entry.fingerprint
    ) invalidateThreadSnapshot(threadId)
  }
  queue = queue.filter((job) => {
    if (job.priority !== 'intent') return false
    const current = currentThreads.get(job.thread.id)
    return current != null &&
      threadCanPrewarm(current) &&
      threadSnapshotFingerprint(current) === job.fingerprint
  })
  const candidates = recentThreadPrewarmCandidates(threads, activeThreadId)
  scheduleIdle(() => {
    idleHandle = null
    if (generation !== scheduleGeneration) return
    for (const thread of candidates) requestThreadPrewarm(thread, 'recent')
  })
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
  cancelScheduledIdle()
  scheduleGeneration += 1
  managerGeneration += 1
  queue = []
  inFlight.clear()
  activeBackgroundRequests = 0
}
