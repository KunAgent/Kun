import type { ThreadEventSink } from '../agent/types'

/** Reachable Graph panel observer lifecycle values (no unused placeholders). */
export type GraphThreadSyncStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'stopped'

export const GRAPH_THREAD_OBSERVER_RECONNECT_BASE_MS = 1_000
export const GRAPH_THREAD_OBSERVER_RECONNECT_MAX_MS = 5_000

export type GraphThreadObserverHandles = {
  stop: () => void
}

export type GraphThreadObserverDeps = {
  threadId: string
  getSinceSeq: () => number
  onSeq: (seq: number) => void
  onStatus: (status: GraphThreadSyncStatus) => void
  onGraphEvent: (event: unknown) => void
  onChildRuntimeEvent?: ThreadEventSink['onChildRuntimeEvent']
  onGraphPlanningEvent?: ThreadEventSink['onGraphPlanningEvent']
  onReplayResetRequired?: (floorSeq: number) => number | Promise<number>
  subscribe: (
    threadId: string,
    sinceSeq: number,
    sink: ThreadEventSink,
    signal: AbortSignal
  ) => Promise<void>
  /** When false after a stream ends, the observer stops reconnecting. */
  shouldReconnect?: () => boolean
  waitForReconnect?: (ms: number, signal: AbortSignal) => Promise<void>
}

function defaultWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const id = globalThis.setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      globalThis.clearTimeout(id)
      resolve()
    }, { once: true })
  })
}

function reconnectDelayMs(attempt: number): number {
  return Math.min(
    GRAPH_THREAD_OBSERVER_RECONNECT_MAX_MS,
    GRAPH_THREAD_OBSERVER_RECONNECT_BASE_MS * (2 ** Math.min(2, Math.max(0, attempt - 1)))
  )
}

/**
 * Independent Graph SSE lifecycle for the Graph panel. Not gated by chat busy:
 * reconnects from a monotonic thread event cursor, and only projects Graph
 * envelopes (plus safe child/planning events) into the Graph store.
 */
export function startGraphThreadObserver(
  deps: GraphThreadObserverDeps
): GraphThreadObserverHandles {
  const controller = new AbortController()
  const wait = deps.waitForReconnect ?? defaultWait
  let reconnectAttempt = 0
  let stopped = false
  let replayResetFloor: number | undefined

  const sink: ThreadEventSink = {
    onConnected: () => {
      if (stopped || controller.signal.aborted) return
      reconnectAttempt = 0
      deps.onStatus('live')
    },
    onSeq: (seq) => {
      if (stopped || controller.signal.aborted) return
      reconnectAttempt = 0
      deps.onSeq(seq)
      deps.onStatus('live')
    },
    onDeltas: () => undefined,
    onUserMessage: () => undefined,
    onTool: () => undefined,
    onCompaction: () => undefined,
    onApproval: () => undefined,
    onUserInput: () => undefined,
    onUserInputStatus: () => undefined,
    onGoal: () => undefined,
    onTurnComplete: () => undefined,
    onError: (error) => {
      if (stopped || controller.signal.aborted) return
      const reset = error as Error & { code?: unknown; floorSeq?: unknown; threadId?: unknown }
      if (
        reset.code === 'replay_reset_required' &&
        reset.threadId === deps.threadId &&
        typeof reset.floorSeq === 'number'
      ) {
        replayResetFloor = reset.floorSeq
      }
      deps.onStatus('reconnecting')
    },
    onChildRuntimeEvent: deps.onChildRuntimeEvent,
    onGraphEvent: deps.onGraphEvent,
    onGraphPlanningEvent: deps.onGraphPlanningEvent
  }

  const loop = async (): Promise<void> => {
    while (!controller.signal.aborted && !stopped) {
      deps.onStatus(reconnectAttempt === 0 ? 'connecting' : 'reconnecting')
      try {
        await deps.subscribe(
          deps.threadId,
          deps.getSinceSeq(),
          sink,
          controller.signal
        )
      } catch {
        if (controller.signal.aborted || stopped) return
      }
      if (controller.signal.aborted || stopped) return
      if (replayResetFloor !== undefined && deps.onReplayResetRequired) {
        const floor = replayResetFloor
        replayResetFloor = undefined
        try {
          const recovered = await deps.onReplayResetRequired(floor)
          deps.onSeq(recovered)
          reconnectAttempt = 0
          continue
        } catch {
          if (controller.signal.aborted || stopped) return
        }
      }
      if (deps.shouldReconnect && !deps.shouldReconnect()) {
        deps.onStatus('stopped')
        return
      }
      reconnectAttempt += 1
      deps.onStatus('reconnecting')
      await wait(reconnectDelayMs(reconnectAttempt), controller.signal)
    }
  }

  void loop()

  return {
    stop: () => {
      if (stopped) return
      stopped = true
      controller.abort()
      deps.onStatus('stopped')
    }
  }
}
