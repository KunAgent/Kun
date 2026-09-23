import {
  KUN_MODEL_CONNECTION_EVENTS_TEMPLATE,
  KUN_MODEL_CONNECTIONS_PATH
} from '@shared/kun-endpoints'
import { rendererRuntimeClient } from '../agent/runtime-client'
import {
  parseSharedModelConnectionEvent,
  parseSharedModelConnections,
  type SharedModelConnectionsSnapshot
} from '../components/settings-section-providers-shared-api'

export const MODEL_CONNECTION_WATCH_WAIT_MS = 25_000
export const MODEL_CONNECTION_WATCH_INITIAL_RETRY_MS = 2_000
export const MODEL_CONNECTION_WATCH_FAILURE_RETRY_MIN_MS = 2_000
export const MODEL_CONNECTION_WATCH_FAILURE_RETRY_MAX_MS = 15_000

export type ModelConnectionWatchListener = (
  snapshot: SharedModelConnectionsSnapshot
) => void | Promise<void>

const listeners = new Set<ModelConnectionWatchListener>()
let loopGeneration = 0
let abort: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let wakeSleep: (() => void) | null = null
let revision = 0
let lastSnapshot: SharedModelConnectionsSnapshot | null = null
let failureDelayMs = MODEL_CONNECTION_WATCH_FAILURE_RETRY_MIN_MS

export function nextModelConnectionWatchDelayMs(input: {
  failed: boolean
  hasRevision: boolean
  failureDelayMs: number
}): { delayMs: number; nextFailureDelayMs: number } {
  if (!input.failed) {
    return {
      delayMs: input.hasRevision ? 0 : MODEL_CONNECTION_WATCH_INITIAL_RETRY_MS,
      nextFailureDelayMs: MODEL_CONNECTION_WATCH_FAILURE_RETRY_MIN_MS
    }
  }
  const delayMs = input.hasRevision
    ? input.failureDelayMs
    : Math.max(input.failureDelayMs, MODEL_CONNECTION_WATCH_INITIAL_RETRY_MS)
  return {
    delayMs,
    nextFailureDelayMs: Math.min(
      Math.max(delayMs, MODEL_CONNECTION_WATCH_FAILURE_RETRY_MIN_MS) * 2,
      MODEL_CONNECTION_WATCH_FAILURE_RETRY_MAX_MS
    )
  }
}

export function subscribeModelConnectionWatch(
  listener: ModelConnectionWatchListener
): () => void {
  listeners.add(listener)
  if (lastSnapshot) void listener(lastSnapshot)
  if (listeners.size === 1) startWatch()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stopWatch()
  }
}

export function resetModelConnectionWatchForTests(): void {
  stopWatch()
}

function startWatch(): void {
  loopGeneration += 1
  void runLoop(loopGeneration)
}

function stopWatch(): void {
  loopGeneration += 1
  abort?.abort()
  abort = null
  if (timer) clearTimeout(timer)
  timer = null
  wakeSleep?.()
  wakeSleep = null
  revision = 0
  lastSnapshot = null
  failureDelayMs = MODEL_CONNECTION_WATCH_FAILURE_RETRY_MIN_MS
}

async function runLoop(generation: number): Promise<void> {
  while (generation === loopGeneration && listeners.size > 0) {
    const controller = new AbortController()
    abort = controller
    let failed = false
    try {
      const snapshot = revision === 0
        ? await fetchSnapshot(controller.signal)
        : await fetchEvent(revision, controller.signal)
      if (generation !== loopGeneration) return
      revision = snapshot.revision
      lastSnapshot = snapshot
      await notifyListeners(snapshot)
    } catch (error) {
      if (generation !== loopGeneration || isAbortError(error)) return
      failed = true
    } finally {
      if (abort === controller) abort = null
    }
    if (generation !== loopGeneration || listeners.size === 0) return
    const next = nextModelConnectionWatchDelayMs({
      failed,
      hasRevision: revision > 0,
      failureDelayMs
    })
    failureDelayMs = next.nextFailureDelayMs
    await sleep(next.delayMs, generation)
  }
}

async function fetchSnapshot(signal: AbortSignal): Promise<SharedModelConnectionsSnapshot> {
  const result = await rendererRuntimeClient.runtimeRequest(
    KUN_MODEL_CONNECTIONS_PATH,
    'GET',
    undefined,
    { signal, priority: 'background' }
  )
  if (!result.ok) throw new Error(`model connection sync failed (HTTP ${result.status})`)
  return parseSharedModelConnections(result.body)
}

async function fetchEvent(
  sinceRevision: number,
  signal: AbortSignal
): Promise<SharedModelConnectionsSnapshot> {
  const result = await rendererRuntimeClient.runtimeRequest(
    `${KUN_MODEL_CONNECTION_EVENTS_TEMPLATE}?since_revision=${sinceRevision}&wait_ms=${MODEL_CONNECTION_WATCH_WAIT_MS}`,
    'GET',
    undefined,
    { signal, priority: 'background' }
  )
  if (!result.ok) throw new Error(`model connection sync failed (HTTP ${result.status})`)
  return parseSharedModelConnectionEvent(result.body)
}

async function notifyListeners(snapshot: SharedModelConnectionsSnapshot): Promise<void> {
  for (const listener of [...listeners]) {
    try {
      await listener(snapshot)
    } catch {
      // Listener failures must not stop the shared watch.
    }
  }
}

function sleep(ms: number, generation: number): Promise<void> {
  if (ms <= 0 || generation !== loopGeneration) return Promise.resolve()
  return new Promise((resolve) => {
    wakeSleep = () => {
      wakeSleep = null
      if (timer) clearTimeout(timer)
      timer = null
      resolve()
    }
    timer = setTimeout(() => {
      timer = null
      wakeSleep = null
      resolve()
    }, ms)
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
