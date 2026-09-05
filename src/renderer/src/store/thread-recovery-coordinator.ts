export type ThreadRecoveryReason =
  | 'selection'
  | 'sse_disconnect'
  | 'watchdog'
  | 'manual_retry'
  | 'runtime_restart'
  | 'send_reconcile'
  | 'replay_reset'

export type ThreadRecoveryOptions = {
  reason?: ThreadRecoveryReason
  forceTimeline?: boolean
}

type RecoveryFlight = {
  controller: AbortController
  promise: Promise<boolean>
  reason: ThreadRecoveryReason
  startedAt: number
}

type CatchingUpEntry = {
  generation: number
  timer: ReturnType<typeof setTimeout>
}

export type ThreadRecoveryDiagnostics = {
  started: number
  joined: number
  cancelled: number
  inflight: number
  forcedHydrations: number
}

const SSE_CATCH_UP_DEADLINE_MS = 30_000

// Reasons that must be allowed to replace a stuck catching-up stream. Passive
// reasons (`selection`, `sse_disconnect`, `send_reconcile`) keep joining so a
// normal in-flight synchronization is not needlessly torn down.
const RECOVERY_PREEMPTIVE_REASONS = new Set<ThreadRecoveryReason>([
  'manual_retry',
  'watchdog',
  'replay_reset',
  'runtime_restart'
])

const flights = new Map<string, RecoveryFlight>()
const attempts = new Map<string, number>()
const forcedHydration = new Set<string>()
const catchingUp = new Map<string, CatchingUpEntry>()
const generations = new Map<string, number>()
const activityListeners = new Set<() => void>()
let started = 0
let joined = 0
let cancelled = 0

function notifyActivity(): void {
  for (const listener of activityListeners) listener()
}

function nextGeneration(threadId: string): number {
  const generation = (generations.get(threadId) ?? 0) + 1
  generations.set(threadId, generation)
  return generation
}

function isCurrentGeneration(threadId: string, generation?: number): boolean {
  return generation === undefined || generations.get(threadId) === generation
}

export function runThreadRecovery(
  threadId: string,
  reason: ThreadRecoveryReason,
  task: (signal: AbortSignal) => Promise<boolean>
): Promise<boolean> {
  const existing = flights.get(threadId)
  if (existing) {
    joined += 1
    return existing.promise
  }
  const catching = catchingUp.get(threadId)
  if (catching) {
    if (!RECOVERY_PREEMPTIVE_REASONS.has(reason)) {
      joined += 1
      return Promise.resolve(true)
    }
    // A forced recovery supersedes a stuck catching-up stream. Cancel its
    // deadline and advance the generation so any late events from the old
    // stream are fenced off before the new physical task starts.
    clearTimeout(catching.timer)
    nextGeneration(threadId)
    catchingUp.delete(threadId)
  }
  const controller = new AbortController()
  started += 1
  const promise = Promise.resolve()
    .then(() => task(controller.signal))
    .finally(() => {
      if (flights.get(threadId)?.promise === promise) {
        flights.delete(threadId)
        notifyActivity()
      }
    })
  flights.set(threadId, { controller, promise, reason, startedAt: Date.now() })
  notifyActivity()
  return promise
}

export function cancelThreadRecovery(threadId: string): void {
  const flight = flights.get(threadId)
  const catching = catchingUp.get(threadId)
  if (catching?.timer) clearTimeout(catching.timer)
  const wasCatchingUp = catchingUp.delete(threadId)
  if (flight) {
    cancelled += 1
    flights.delete(threadId)
    flight.controller.abort()
  }
  if (flight || wasCatchingUp) notifyActivity()
}

export function cancelThreadRecoveriesExcept(threadId?: string): void {
  for (const candidate of new Set([...flights.keys(), ...catchingUp.keys()])) {
    if (candidate !== threadId) cancelThreadRecovery(candidate)
  }
}

export function hasForegroundThreadRecovery(): boolean {
  return flights.size > 0 || catchingUp.size > 0
}

export function onThreadRecoveryActivity(listener: () => void): () => void {
  activityListeners.add(listener)
  return () => activityListeners.delete(listener)
}

export function requireThreadTimelineHydration(threadId: string): void {
  forcedHydration.add(threadId)
}

export function markThreadRecoveryCatchingUp(
  threadId: string,
  onDeadline?: () => void
): number {
  const generation = nextGeneration(threadId)
  const previous = catchingUp.get(threadId)
  if (previous?.timer) clearTimeout(previous.timer)
  const timer = setTimeout(() => {
    const current = catchingUp.get(threadId)
    if (!current || current.generation !== generation) return
    catchingUp.delete(threadId)
    notifyActivity()
    onDeadline?.()
  }, SSE_CATCH_UP_DEADLINE_MS)
  catchingUp.set(threadId, { generation, timer })
  notifyActivity()
  return generation
}

export function releaseThreadRecoveryCatchup(threadId: string, generation?: number): void {
  if (!isCurrentGeneration(threadId, generation)) return
  const entry = catchingUp.get(threadId)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  catchingUp.delete(threadId)
  notifyActivity()
}

export function consumeThreadTimelineHydration(threadId: string): boolean {
  return forcedHydration.delete(threadId)
}

export function noteThreadRecoveryEvidence(threadId: string, generation?: number): void {
  if (!isCurrentGeneration(threadId, generation)) return
  attempts.delete(threadId)
  releaseThreadRecoveryCatchup(threadId, generation)
}

export function threadRecoveryBackoffMs(
  threadId: string,
  random: () => number = Math.random
): number {
  const attempt = Math.min((attempts.get(threadId) ?? 0) + 1, 8)
  attempts.set(threadId, attempt)
  const ceiling = Math.min(30_000, 500 * (2 ** (attempt - 1)))
  return Math.max(0, Math.floor(random() * ceiling))
}

export function threadRecoveryDiagnostics(): ThreadRecoveryDiagnostics {
  return {
    started,
    joined,
    cancelled,
    inflight: flights.size + catchingUp.size,
    forcedHydrations: forcedHydration.size
  }
}

export function resetThreadRecoveryCoordinator(): void {
  for (const flight of flights.values()) flight.controller.abort()
  flights.clear()
  attempts.clear()
  forcedHydration.clear()
  for (const entry of catchingUp.values()) {
    if (entry.timer) clearTimeout(entry.timer)
  }
  catchingUp.clear()
  generations.clear()
  started = 0
  joined = 0
  cancelled = 0
  notifyActivity()
}
