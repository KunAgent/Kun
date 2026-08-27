import type { AgentProvider, ThreadEventSink } from '../agent/types'
import type { ChatState, ChatStoreGet } from './chat-store-types'
export { composerSelectionForThread } from './chat-store-thread-composer-state'

const SSE_RECOVERY_INITIAL_DELAY_MS = 250
const SSE_RECOVERY_AUTH_DELAY_MS = 2_000
const SSE_RECOVERY_MAX_DELAY_MS = 10_000

type SseRecoveryState = {
  attempts: number
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
  const recoverySink: ThreadEventSink = {
    ...sink,
    onSeq: (seq) => {
      resetSseRecovery(threadId, subscription)
      sink.onSeq(seq)
    },
    onError: (error, options) => {
      terminalError = error
      sink.onError(error, options)
    }
  }
  void provider.subscribeThreadEvents(threadId, sinceSeq, recoverySink, signal)
    .catch((error) => {
      terminalError = error instanceof Error ? error : new Error(String(error))
    })
    .then(() => {
      if (signal.aborted) return
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
  const attempts = state?.subscription === subscription ? state.attempts : 0
  if (state?.subscription === subscription && state.timer) return
  const next: SseRecoveryState = { attempts: Math.min(attempts + 1, 8), subscription }
  const status = sseStatus(error)
  const baseDelay = status === 401 || status === 403
    ? SSE_RECOVERY_AUTH_DELAY_MS
    : SSE_RECOVERY_INITIAL_DELAY_MS
  const delay = Math.min(baseDelay * (2 ** (next.attempts - 1)), SSE_RECOVERY_MAX_DELAY_MS)
  next.timer = setTimeout(() => {
    const scheduled = sseRecoveries.get(threadId)
    if (scheduled?.subscription !== subscription || scheduled.timer !== next.timer) return
    next.timer = undefined
    sseRecoveries.delete(threadId)
    const current = get()
    if (current.activeThreadId !== threadId) return
    void current.recoverActiveTurn()
  }, delay)
  sseRecoveries.set(threadId, next)
}

function sseStatus(error: Error | undefined): number | undefined {
  const value = error as (Error & { status?: unknown }) | undefined
  return typeof value?.status === 'number' ? value.status : undefined
}
