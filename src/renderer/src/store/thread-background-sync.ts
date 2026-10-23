import type { AgentProvider, NormalizedThread } from '../agent/types'
import { loadThreadStates } from '../agent/thread-state-loader'
import { codexReferenceRevision } from '../history-reference/codex-reference-state'
import { getRuntimeErrorCode } from '../lib/format-runtime-error'
import type { ChatState } from './chat-store-types'
import { threadLooksRunning } from './chat-store-runtime-helpers'
import {
  buildPrefetchedThreadSnapshot,
  cacheThreadSnapshot,
  captureThreadSnapshotCacheToken,
  clearThreadSnapshotCache,
  invalidateThreadSnapshot,
  threadSnapshotCacheTokenIsCurrent,
  threadSnapshotCacheGenerationIsCurrent,
  threadSnapshotFingerprint,
  THREAD_SNAPSHOT_CACHE_MAX_ENTRIES,
  type ThreadSnapshotCacheToken
} from './thread-snapshot-cache'

export const BACKGROUND_THREAD_SYNC_INTERVAL_MS = 2_000
/** A quiet running owner whose page is due is probed with a cheap state read this often. */
export const BACKGROUND_THREAD_SYNC_HEARTBEAT_MS = 15_000
/**
 * A running owner's full timeline page is re-read at most this often. One
 * page of a long running conversation costs the runtime seconds, and reopening
 * re-hydrates from the server anyway; the turn's completion still re-reads at once.
 */
export const BACKGROUND_THREAD_SYNC_RUNNING_REFRESH_MS = 60_000
export const BACKGROUND_THREAD_SYNC_CONCURRENCY = 2
const RETRY_MS = 15_000

type SyncState = Pick<ChatState, 'activeThreadId' | 'threads' | 'adeThreads' | 'runtimeConnection'>
type Entry = {
  thread: NormalizedThread
  fingerprint?: string
  running: boolean
  requestedAt: number
  retryAt: number
  /** Highest sequence the committed page is known to cover. */
  lastSeq: number
  probedAt: number
  /** A state probe saw progress or completion: the next pump reads the page. */
  advanced: boolean
  controller?: AbortController
  token?: ThreadSnapshotCacheToken
  unavailable?: string
}

export type BackgroundThreadSyncProvider = Pick<AgentProvider, 'getThreadDetail'> &
  Partial<Pick<AgentProvider, 'getThreadState' | 'getThreadStates'>>

export type BackgroundThreadSyncDependencies = {
  getState: () => SyncState
  subscribe: (changed: () => void) => () => void
  getProvider: () => BackgroundThreadSyncProvider
  canRequest?: () => boolean
}

/**
 * Owns bounded data checkpoints independently of mounted timelines. Reading a
 * timeline never dispatches events, resolves gates, sends turns or notifies:
 * those effects still belong to the active stream and existing activity feed.
 */
export function createBackgroundThreadSync(deps: BackgroundThreadSyncDependencies): () => void {
  const recent = new Map<string, { thread: NormalizedThread; token: ThreadSnapshotCacheToken }>()
  const entries = new Map<string, Entry>()
  let activeId: string | null = null
  let connected = false
  let stopped = false
  let generation = 0
  let inFlight = 0
  let queued = false
  let historyRevision = codexReferenceRevision()

  const cancel = (id: string, entry: Entry): void => {
    entry.controller?.abort()
    entries.delete(id)
  }

  const schedule = (): void => {
    if (queued || stopped) return
    queued = true
    queueMicrotask(() => { queued = false; if (!stopped) pump() })
  }

  // A batched state read says whether quiet running owners moved at all, so
  // their pages are only re-read when something happened.
  const probe = (targets: Entry[], provider: BackgroundThreadSyncProvider): void => {
    const now = Date.now()
    const requestGeneration = generation
    for (const entry of targets) entry.probedAt = now
    void loadThreadStates(provider as Pick<AgentProvider, 'getThreadState' | 'getThreadStates'>,
      targets.map((entry) => entry.thread.id)).then((results) => {
      if (stopped || generation !== requestGeneration) return
      let moved = false
      for (const result of results) {
        const entry = entries.get(result.id)
        if (!entry || !result.ok) continue
        if (result.state.latestSeq > entry.lastSeq || !threadLooksRunning(result.state)) {
          entry.advanced = true
          moved = true
        }
      }
      if (moved) schedule()
    }).catch(() => undefined)
  }

  const pump = (): void => {
    const state = deps.getState()
    const revision = codexReferenceRevision()
    if (revision !== historyRevision || (connected && state.runtimeConnection !== 'ready')) {
      generation += 1
      for (const [id, entry] of entries) cancel(id, entry)
      clearThreadSnapshotCache()
      historyRevision = revision
    }
    connected = state.runtimeConnection === 'ready'
    if (!connected) return
    const listed = new Map([...state.threads, ...(state.adeThreads ?? [])].map((thread) => [thread.id, thread]))
    // Sidebar pages/searches are partial inventories. Only an explicit archive,
    // invalidation plus removal, or a 404 proves a recent owner disappeared.
    const threads = new Map(listed)
    for (const [id, entry] of entries) {
      if (!listed.has(id) && entry.token && !threadSnapshotCacheGenerationIsCurrent(id, entry.token)) {
        cancel(id, entry); recent.delete(id)
      } else if (!listed.has(id)) threads.set(id, entry.thread)
    }
    for (const [id, entry] of recent) {
      if (!listed.has(id) && !threadSnapshotCacheGenerationIsCurrent(id, entry.token)) {
        recent.delete(id)
        continue
      }
      if (!threads.has(id)) threads.set(id, entry.thread)
      else recent.set(id, { thread: threads.get(id)!, token: captureThreadSnapshotCacheToken(id) })
    }
    if (activeId !== state.activeThreadId || (activeId && !recent.has(activeId) && listed.has(activeId))) {
      activeId = state.activeThreadId
      if (activeId && threads.has(activeId)) {
        recent.delete(activeId)
        recent.set(activeId, { thread: threads.get(activeId)!, token: captureThreadSnapshotCacheToken(activeId) })
      }
      while (recent.size > THREAD_SNAPSHOT_CACHE_MAX_ENTRIES) recent.delete(recent.keys().next().value!)
    }
    for (const id of recent.keys()) {
      if (threads.get(id)?.archived) recent.delete(id)
    }
    const eligible = (thread: NormalizedThread | undefined): thread is NormalizedThread =>
      Boolean(thread && !thread.archived && thread.id !== state.activeThreadId)
    const wanted = new Map<string, NormalizedThread>()
    for (const id of [...recent.keys()].reverse()) {
      const thread = threads.get(id)
      if (eligible(thread)) wanted.set(id, thread)
    }
    for (const thread of threads.values()) {
      if (wanted.size >= THREAD_SNAPSHOT_CACHE_MAX_ENTRIES) break
      if (eligible(thread) && threadLooksRunning(thread)) wanted.set(thread.id, thread)
    }
    for (const [id, entry] of entries) {
      if (wanted.size >= THREAD_SNAPSHOT_CACHE_MAX_ENTRIES) break
      const thread = threads.get(id) ?? entry.thread
      if (eligible(thread)) wanted.set(id, thread)
    }
    for (const [id, entry] of entries) {
      if (wanted.has(id)) continue
      cancel(id, entry)
      if (!threads.has(id) || threads.get(id)?.archived) invalidateThreadSnapshot(id)
    }
    for (const [id, thread] of wanted) {
      if (!entries.has(id)) {
        entries.set(id, { thread, running: threadLooksRunning(thread), requestedAt: -Infinity, retryAt: 0,
          lastSeq: -1, probedAt: -Infinity, advanced: false })
      } else entries.get(id)!.thread = thread
    }
    if (deps.canRequest?.() === false) return
    const now = Date.now()
    const provider = deps.getProvider()
    const probing = typeof provider.getThreadStates === 'function' || typeof provider.getThreadState === 'function'
    const probes: Entry[] = []
    // Oldest request first prevents a noisy conversation starving other owners.
    const candidates = [...wanted.values()].sort((a, b) => entries.get(a.id)!.requestedAt - entries.get(b.id)!.requestedAt)
    for (const thread of candidates) {
      if (inFlight >= BACKGROUND_THREAD_SYNC_CONCURRENCY) break
      const entry = entries.get(thread.id)!
      if (entry.controller || entry.retryAt > now) continue
      const running = threadLooksRunning(thread)
      const fingerprint = threadSnapshotFingerprint(thread)
      if (entry.unavailable === fingerprint) continue
      const dirty = entry.fingerprint !== fingerprint || Boolean(entry.token && !threadSnapshotCacheGenerationIsCurrent(thread.id, entry.token))
      const completing = entry.running && !running
      const elapsed = now - entry.requestedAt
      if (Number.isFinite(entry.requestedAt) && !completing && !entry.advanced) {
        if (running) {
          // One page per refresh window. Between windows a quiet owner is only
          // probed; without a state API the window alone paces the re-read.
          if (elapsed < BACKGROUND_THREAD_SYNC_RUNNING_REFRESH_MS) continue
          if (!dirty && probing) {
            if (now - entry.probedAt >= BACKGROUND_THREAD_SYNC_HEARTBEAT_MS) probes.push(entry)
            continue
          }
        } else if (!dirty || elapsed < BACKGROUND_THREAD_SYNC_INTERVAL_MS) continue
      }
      const controller = new AbortController()
      const token = captureThreadSnapshotCacheToken(thread.id)
      const requestGeneration = generation
      entry.controller = controller
      entry.token = token
      entry.requestedAt = now
      entry.advanced = false
      inFlight += 1
      void Promise.resolve().then(() => provider.getThreadDetail(thread.id, {
        signal: controller.signal, priority: 'background'
      })).then((detail) => {
        const current = deps.getState()
        const currentThread = current.threads.find((item) => item.id === thread.id) ??
          current.adeThreads?.find((item) => item.id === thread.id) ?? entry.thread
        const sameRunningTurn = running && threadLooksRunning(currentThread) &&
          Boolean(thread.latestTurnId) && currentThread.latestTurnId === thread.latestTurnId &&
          (currentThread.relation ?? 'primary') === (thread.relation ?? 'primary') &&
          currentThread.parentThreadId === thread.parentThreadId &&
          (currentThread.latestSeq ?? 0) >= (thread.latestSeq ?? 0)
        if (stopped || controller.signal.aborted || generation !== requestGeneration ||
          codexReferenceRevision() !== revision || current.runtimeConnection !== 'ready' ||
          current.activeThreadId === thread.id || entries.get(thread.id) !== entry ||
          !currentThread || currentThread.archived ||
          (threadSnapshotFingerprint(currentThread) !== fingerprint && !sameRunningTurn) ||
          !threadSnapshotCacheTokenIsCurrent(thread.id, token)) {
          entry.retryAt = Date.now() + BACKGROUND_THREAD_SYNC_INTERVAL_MS
          return
        }
        // Stamp only metadata observed at request start. Newer sidebar progress
        // stays dirty; the server's safe floor is never replaced by latestSeq.
        const snapshot = buildPrefetchedThreadSnapshot(thread, detail, { allowRunning: true })
        if (snapshot) cacheThreadSnapshot({ ...snapshot, backgroundSyncedAt: Date.now() }, token)
        entry.fingerprint = fingerprint
        entry.token = captureThreadSnapshotCacheToken(thread.id)
        entry.running = running
        entry.lastSeq = Math.max(detail.latestSeq, thread.latestSeq ?? 0)
        entry.retryAt = 0
      }).catch((error) => {
        if (controller.signal.aborted) return
        if (getRuntimeErrorCode(error) === 'not_found') {
          invalidateThreadSnapshot(thread.id)
          entry.unavailable = fingerprint
          recent.delete(thread.id)
        }
        entry.retryAt = Date.now() + RETRY_MS
      }).finally(() => {
        entry.controller = undefined
        inFlight -= 1
        schedule()
      })
    }
    if (probes.length > 0) probe(probes, provider)
  }

  const unsubscribe = deps.subscribe(() => {
    // Fence selection immediately, including A -> B -> A within one tick.
    // Coalescing only the network scheduling must not coalesce ownership.
    const state = deps.getState()
    const active = state.activeThreadId ? entries.get(state.activeThreadId) : undefined
    active?.controller?.abort()
    if (state.runtimeConnection !== 'ready' || codexReferenceRevision() !== historyRevision) {
      generation += 1
      for (const [id, entry] of entries) cancel(id, entry)
      clearThreadSnapshotCache()
      connected = false
      historyRevision = codexReferenceRevision()
    }
    schedule()
  })
  const timer = setInterval(schedule, BACKGROUND_THREAD_SYNC_INTERVAL_MS)
  schedule()
  return () => {
    stopped = true
    generation += 1
    unsubscribe()
    clearInterval(timer)
    for (const [id, entry] of entries) cancel(id, entry)
    recent.clear()
  }
}
