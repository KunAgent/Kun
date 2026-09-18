import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'

let startupRuntimeProbeTimer: ReturnType<typeof setTimeout> | null = null
// Guards against duplicate startup probes: the immediate probe runs first and
// the 900ms fallback must not race it while it is still in flight.
let startupRuntimeProbeInFlight = false
// Bumped on every scheduleStartupRuntimeProbe call so stale timers/probes from
// an earlier scheduling round can never fire a probe for the current round.
let startupProbeGeneration = 0
// Bounds how many times a fallback may reschedule itself while the runtime
// stays unready; afterwards Runtime status events or user actions take over.
const STARTUP_PROBE_MAX_FALLBACKS = 5
const STARTUP_PROBE_FALLBACK_MS = 900
// Slow background re-probe that keeps retrying while the runtime connection
// is offline. `probeRuntime` arms it after every failed probe and cancels it
// on success, so the GUI reconnects on its own once the runtime comes back
// (crash recovery, transient manager outage, missed status event). It only
// ever calls `probeRuntime('background')`, which leaves user-facing error
// state untouched.
export const OFFLINE_RUNTIME_PROBE_INTERVAL_MS = 15_000
let offlineRuntimeProbeTimer: ReturnType<typeof setTimeout> | null = null
let offlineRuntimeProbeInFlight = false
// Bumped only by cancelOfflineRuntimeProbe so a timer or in-flight probe
// armed before a cancel can never continue the chain afterwards.
let offlineProbeGeneration = 0
let busyWatchdogTimer: ReturnType<typeof setTimeout> | null = null
let busyRecoveryAttempts = 0
let turnCompletionPollTimer: ReturnType<typeof setInterval> | null = null
let turnCompletionPollInFlight = false
export const TURN_COMPLETION_POLL_CONCURRENCY = 4

type BusyWatchdogOptions = {
  timeoutMs: number
  maxAttempts: number
  finalizeBusyState: (state: ChatState) => Partial<ChatState>
  flushLiveBlocks: (state: ChatState, base: Partial<ChatState>) => Partial<ChatState>
  busyTimeoutMessage: () => string
}

type ThreadCompletionState = {
  status: string
  latestTurnId?: string
  latestTurnStatus?: string
  completionWatchKey?: string
}

type TurnCompletionPollOptions = {
  loadThreadState: (
    state: ChatState,
    threadId: string
  ) => Promise<ThreadCompletionState>
  loadThreadStates?: (
    state: ChatState,
    threadIds: string[]
  ) => Promise<Array<
    | { id: string; ok: true; state: ThreadCompletionState }
    | { id: string; ok: false; missing: boolean }
  >>
  threadLooksRunning: (thread: ThreadCompletionState) => boolean
  onCompletedThreads: (
    done: Array<{
      id: string
      latestTurnId?: string
      latestTurnStatus?: string
      completionWatchKey?: string
    }>,
    state: ChatState,
    set: ChatStoreSet,
    get: ChatStoreGet
  ) => void | Promise<void>
  isMissingThreadError?: (error: unknown) => boolean
  onMissingThreads?: (
    ids: string[],
    state: ChatState,
    set: ChatStoreSet,
    get: ChatStoreGet
  ) => void | Promise<void>
}

type CompletionPollOutcome =
  | {
      kind: 'completed'
      id: string
      latestTurnId?: string
      latestTurnStatus?: string
      completionWatchKey?: string
    }
  | { kind: 'missing'; id: string }
  | null

export function scheduleStartupRuntimeProbe(get: ChatStoreGet): void {
  if (startupRuntimeProbeTimer) {
    clearTimeout(startupRuntimeProbeTimer)
    startupRuntimeProbeTimer = null
  }
  startupProbeGeneration += 1
  const generation = startupProbeGeneration
  if (startupRuntimeProbeInFlight) return
  runStartupProbe(get, generation)
  armStartupProbeFallback(get, generation, 0)
}

function runStartupProbe(get: ChatStoreGet, generation: number): void {
  // Probe immediately when the runtime is already up so the sidebar gets its
  // thread inventory as fast as possible instead of waiting a fixed 900ms.
  startupRuntimeProbeInFlight = true
  void (async () => {
    try {
      await get().probeRuntime('user')
    } finally {
      startupRuntimeProbeInFlight = false
      // A slow first probe (settings + provider connect + thread list refresh)
      // can outlive the 900ms fallback armed below. If the connection still is
      // not ready by now, re-arm the fallback from this point so the earlier
      // timer firing during the probe does not consume the only retry.
      if (generation === startupProbeGeneration &&
        !startupRuntimeProbeTimer &&
        !startupRuntimeProbeInFlight &&
        get().runtimeConnection !== 'ready') {
        armStartupProbeFallback(get, generation, 0)
      }
    }
  })()
}

function armStartupProbeFallback(get: ChatStoreGet, generation: number, attempt: number): void {
  // Keep a fallback probe for the case where the runtime is still cold-starting
  // (e.g. `kun serve` booting) and the immediate probe raced it. It only fires
  // when the runtime did not reach `ready` yet and no other probe is running.
  startupRuntimeProbeTimer = setTimeout(() => {
    startupRuntimeProbeTimer = null
    if (generation !== startupProbeGeneration) return
    if (get().runtimeConnection === 'ready') return
    if (startupRuntimeProbeInFlight) {
      // The previous probe is still running past the fallback window. Do not
      // swallow this fallback: reschedule it so one eventually fires after the
      // in-flight probe settles, until the retry budget is exhausted.
      if (attempt < STARTUP_PROBE_MAX_FALLBACKS) {
        armStartupProbeFallback(get, generation, attempt + 1)
      }
      return
    }
    runStartupProbe(get, generation)
  }, STARTUP_PROBE_FALLBACK_MS)
}

export function scheduleOfflineRuntimeProbe(get: ChatStoreGet): void {
  if (offlineRuntimeProbeTimer || offlineRuntimeProbeInFlight) return
  armOfflineRuntimeProbe(get, offlineProbeGeneration)
}

export function cancelOfflineRuntimeProbe(): void {
  offlineProbeGeneration += 1
  if (offlineRuntimeProbeTimer) {
    clearTimeout(offlineRuntimeProbeTimer)
    offlineRuntimeProbeTimer = null
  }
}

function armOfflineRuntimeProbe(get: ChatStoreGet, generation: number): void {
  offlineRuntimeProbeTimer = setTimeout(() => {
    offlineRuntimeProbeTimer = null
    if (generation !== offlineProbeGeneration) return
    const state = get()
    if (state.runtimeConnection === 'ready') return
    if (state.runtimeConnection === 'checking') {
      // A user-initiated probe is already retrying; wait for its verdict
      // instead of racing it with a background probe.
      scheduleOfflineRuntimeProbe(get)
      return
    }
    offlineRuntimeProbeInFlight = true
    void Promise.resolve()
      .then(() => state.probeRuntime('background'))
      .catch(() => undefined)
      .finally(() => {
        offlineRuntimeProbeInFlight = false
        if (generation !== offlineProbeGeneration) return
        if (get().runtimeConnection === 'ready') return
        // Still offline: re-arm so the chain keeps retrying until the
        // runtime is reachable again.
        scheduleOfflineRuntimeProbe(get)
      })
  }, OFFLINE_RUNTIME_PROBE_INTERVAL_MS)
}

export function clearBusyWatchdog(): void {
  if (busyWatchdogTimer) {
    clearTimeout(busyWatchdogTimer)
    busyWatchdogTimer = null
  }
}

export function resetBusyRecoveryAttempts(): void {
  busyRecoveryAttempts = 0
}

export function armBusyWatchdog(
  set: ChatStoreSet,
  get: ChatStoreGet,
  options: BusyWatchdogOptions
): void {
  clearBusyWatchdog()
  busyWatchdogTimer = setTimeout(() => {
    const state = get()
    if (!state.busy) return
    busyRecoveryAttempts += 1
    if (busyRecoveryAttempts <= options.maxAttempts && state.activeThreadId) {
      void state.recoverActiveTurn()
      return
    }
    set((snapshot) => {
      const base: Partial<ChatState> = {
        ...options.finalizeBusyState(snapshot),
        busy: false,
        busyUnconfirmed: false,
        currentTurnId: null,
        currentTurnOrchestration: null,
        error: options.busyTimeoutMessage()
      }
      return options.flushLiveBlocks(snapshot, base)
    })
    // The thread is idle again as far as the UI is concerned; queued
    // messages would otherwise wait for a completion event that will
    // never come.
    void get().drainQueuedMessages?.()
  }, options.timeoutMs)
}

export function stopTurnCompletionPoll(): void {
  if (turnCompletionPollTimer) {
    clearInterval(turnCompletionPollTimer)
    turnCompletionPollTimer = null
  }
}

export function syncTurnCompletionPoll(
  set: ChatStoreSet,
  get: ChatStoreGet,
  options: TurnCompletionPollOptions
): void {
  const ids = Object.keys(get().watchTurnCompletion).filter((id) => get().watchTurnCompletion[id])
  if (ids.length === 0) {
    stopTurnCompletionPoll()
    return
  }
  if (turnCompletionPollTimer != null) return

  const tick = (): void => {
    if (turnCompletionPollInFlight) return
    turnCompletionPollInFlight = true
    void pollTurnCompletionWatch(set, get, options).finally(() => {
      turnCompletionPollInFlight = false
    })
  }

  turnCompletionPollTimer = setInterval(tick, 2500)
  void tick()
}

async function pollTurnCompletionWatch(
  set: ChatStoreSet,
  get: ChatStoreGet,
  options: TurnCompletionPollOptions
): Promise<void> {
  const state = get()
  if (state.runtimeConnection !== 'ready') {
    stopTurnCompletionPoll()
    return
  }

  const ids = Object.keys(state.watchTurnCompletion).filter((id) => state.watchTurnCompletion[id])
  if (ids.length === 0) {
    stopTurnCompletionPoll()
    return
  }

  const loadOne = async (threadId: string): Promise<CompletionPollOutcome> => {
    try {
      const thread = await options.loadThreadState(state, threadId)
      return completionOutcome(threadId, thread, options.threadLooksRunning)
    } catch (error) {
      return options.isMissingThreadError?.(error) ? { kind: 'missing' as const, id: threadId } : null
    }
  }
  let outcomes: CompletionPollOutcome[]
  if (options.loadThreadStates) {
    try {
      const results = await options.loadThreadStates(state, ids)
      outcomes = results.map((result) => result.ok
        ? completionOutcome(result.id, result.state, options.threadLooksRunning)
        : result.missing ? { kind: 'missing' as const, id: result.id } : null)
    } catch {
      outcomes = ids.map(() => null)
    }
  } else {
    outcomes = new Array(ids.length)
    let cursor = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor
        cursor += 1
        if (index >= ids.length) return
        outcomes[index] = await loadOne(ids[index])
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(TURN_COMPLETION_POLL_CONCURRENCY, ids.length) },
      worker
    ))
  }
  const completed = outcomes.filter((outcome): outcome is Extract<CompletionPollOutcome, { kind: 'completed' }> =>
    outcome?.kind === 'completed'
  )
  const done = completed.map(({
    id,
    latestTurnId,
    latestTurnStatus,
    completionWatchKey
  }) => ({
    id,
    latestTurnId,
    latestTurnStatus,
    completionWatchKey
  }))
  const missingIds = outcomes.flatMap((outcome) =>
    outcome?.kind === 'missing' ? [outcome.id] : []
  )

  if (done.length > 0) {
    await options.onCompletedThreads(done, state, set, get)
  }
  if (missingIds.length > 0) {
    await options.onMissingThreads?.(missingIds, state, set, get)
  }

  if (Object.keys(get().watchTurnCompletion).filter((id) => get().watchTurnCompletion[id]).length === 0) {
    stopTurnCompletionPoll()
  }
}

function completionOutcome(
  threadId: string,
  thread: ThreadCompletionState,
  threadLooksRunning: (thread: ThreadCompletionState) => boolean
): CompletionPollOutcome {
  return threadLooksRunning(thread)
    ? null
    : {
        kind: 'completed',
        id: threadId,
        latestTurnId: thread.latestTurnId,
        latestTurnStatus: thread.latestTurnStatus,
        completionWatchKey: thread.completionWatchKey
      }
}
