import type { AgentProvider, ThreadEventSink } from '../agent/types'
import type { ChatState, ChatStoreGet } from './chat-store-types'
import {
  noteThreadRecoveryEvidence,
  markThreadRecoveryCatchingUp,
  releaseThreadRecoveryCatchup,
  requireThreadTimelineHydration,
  threadRecoveryBackoffMs
} from './thread-recovery-coordinator'
export { composerSelectionForThread } from './chat-store-thread-composer-state'

const SSE_RECOVERY_AUTH_DELAY_MS = 2_000

type SseRecoveryState = {
  subscription: symbol
  timer?: ReturnType<typeof setTimeout>
}

const sseRecoveries = new Map<string, SseRecoveryState>()

export function fallbackComposerProviderIdForSend(state: ChatState): string {
  return state.route === 'claw' ? '' : state.composerProviderId.trim()
}

export async function ensureRuntimeProviderForSend(input: {
  providerId?: string
  model?: string
}): Promise<void> {
  const providerId = input.providerId?.trim()
  const model = input.model?.trim()
  if (!providerId || !model || model.toLowerCase() === 'auto') return
}

export function subscribeThreadEventsWithRecovery(
  provider: AgentProvider,
  threadId: string,
  sinceSeq: number,
  sink: ThreadEventSink,
  signal: AbortSignal,
  get: ChatStoreGet
): void {
  const subscription = Symbol(`sse:${threadId}`)
  const pendingRecovery = sseRecoveries.get(threadId)
  if (pendingRecovery?.timer) {
    clearTimeout(pendingRecovery.timer)
    pendingRecovery.timer = undefined
  }
  let terminalError: Error | undefined
  const onCatchupDeadline = (): void => {
    if (get().activeThreadId !== threadId) return
    void get().recoverActiveTurn({ reason: 'watchdog', forceTimeline: true })
  }
  const generation = markThreadRecoveryCatchingUp(threadId, onCatchupDeadline)
  const recoverySink: ThreadEventSink = {
    ...sink,
    onSeq: (seq) => {
      resetSseRecovery(threadId, subscription)
      sink.onSeq(seq)
    },
    onReplaySynchronized: (cursor) => {
      noteThreadRecoveryEvidence(threadId, generation)
      resetSseRecovery(threadId, subscription)
      sink.onReplaySynchronized?.(cursor)
    },
    onTurnComplete: (event) => {
      noteThreadRecoveryEvidence(threadId, generation)
      sink.onTurnComplete(event)
    },
    onError: (error, options) => {
      terminalError = error
      releaseThreadRecoveryCatchup(threadId, generation)
      if (isReplayReset(error, threadId)) requireThreadTimelineHydration(threadId)
      if (!isReplayReset(error, threadId)) sink.onError(error, options)
    }
  }
  void provider.subscribeThreadEvents(threadId, sinceSeq, recoverySink, signal)
    .catch((error) => {
      terminalError = error instanceof Error ? error : new Error(String(error))
    })
    .then(() => {
      if (signal.aborted) return
      releaseThreadRecoveryCatchup(threadId, generation)
      const state = get()
      // The selected thread must remain subscribed even after its parent turn
      // settles. Runtime restart reconciliation can publish child
      // `runtime_restart` events after the parent became non-busy; stopping
      // recovery here leaves those cards permanently stuck at queued/running.
      if (state.activeThreadId !== threadId) return
      scheduleSseRecovery(threadId, subscription, terminalError, get)
    })
}

function resetSseRecovery(threadId: string, subscription: symbol): void {
  const state = sseRecoveries.get(threadId)
  if (state?.subscription !== subscription) return
  if (state.timer) clearTimeout(state.timer)
  sseRecoveries.delete(threadId)
}

function scheduleSseRecovery(
  threadId: string,
  subscription: symbol,
  error: Error | undefined,
  get: ChatStoreGet
): void {
  const state = sseRecoveries.get(threadId)
  if (state?.subscription === subscription && state.timer) return
  const next: SseRecoveryState = { subscription }
  const status = sseStatus(error)
  const delay = isReplayReset(error, threadId)
    ? 0
    : Math.max(
        status === 401 || status === 403 ? SSE_RECOVERY_AUTH_DELAY_MS : 0,
        threadRecoveryBackoffMs(threadId)
      )
  next.timer = setTimeout(() => {
    const scheduled = sseRecoveries.get(threadId)
    if (scheduled?.subscription !== subscription || scheduled.timer !== next.timer) return
    next.timer = undefined
    sseRecoveries.delete(threadId)
    const current = get()
    if (current.activeThreadId !== threadId) return
    const reset = isReplayReset(error, threadId)
    void current.recoverActiveTurn({
      reason: reset ? 'replay_reset' : 'sse_disconnect',
      forceTimeline: reset
    })
  }, delay)
  sseRecoveries.set(threadId, next)
}

function sseStatus(error: Error | undefined): number | undefined {
  const value = error as (Error & { status?: unknown }) | undefined
  return typeof value?.status === 'number' ? value.status : undefined
}

function isReplayReset(error: Error | undefined, threadId: string): boolean {
  const value = error as (Error & { code?: unknown; threadId?: unknown; floorSeq?: unknown }) | undefined
  return value?.code === 'replay_reset_required' &&
    value.threadId === threadId &&
    typeof value.floorSeq === 'number' &&
    Number.isSafeInteger(value.floorSeq) &&
    value.floorSeq >= 0
}
