import type { AgentProvider, NormalizedThread, ThreadEventSink } from '../agent/types'
import { decideSseRecovery, type SseStreamCloseSignal } from '@shared/sse-sequence'
import type { ChatState, ChatStoreGet } from './chat-store-types'
import {
  composerModelSelectable,
  providerIdForComposerModel,
  providerIdMatchesComposerModel,
  readThreadComposerSelection
} from './chat-store-helpers'

const SSE_RECOVERY_INITIAL_DELAY_MS = 250
const SSE_RECOVERY_AUTH_DELAY_MS = 2_000
const SSE_RECOVERY_MAX_DELAY_MS = 10_000

type SseRecoveryState = {
  attempts: number
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

export function composerSelectionForThread(
  state: ChatState,
  thread: Pick<NormalizedThread, 'id' | 'model'> | null | undefined,
  options: {
    hasUserMessages?: boolean
    runtimeModel?: string
  } = {}
): { model: string; providerId: string } | null {
  if (!thread) return null
  const pickList = state.composerPickList
  const stored = readThreadComposerSelection(thread.id)
  const storedModel = stored?.model.trim() ?? ''
  const threadModel = options.runtimeModel?.trim() || thread.model.trim()
  const storedSelectable = composerModelSelectable(pickList, state.composerModelGroups, storedModel)
  const storedShouldWin = storedSelectable && (
    options.hasUserMessages !== false ||
    stored?.source === 'user' ||
    stored?.source === 'default'
  )
  const model = storedShouldWin
    ? storedModel
    : composerModelSelectable(pickList, state.composerModelGroups, threadModel)
      ? threadModel
      : storedSelectable
        ? storedModel
        : ''
  if (!model) return null
  const usesStoredModel = storedModel.toLowerCase() === model.toLowerCase()
  const storedProviderId =
    stored && usesStoredModel &&
      providerIdMatchesComposerModel(state.composerModelGroups, stored.providerId, model)
      ? stored.providerId
      : ''
  return {
    model,
    providerId: storedProviderId || providerIdForComposerModel(state.composerModelGroups, model)
  }
}

export function subscribeThreadEventsWithRecovery(
  provider: AgentProvider,
  threadId: string,
  sinceSeq: number,
  sink: ThreadEventSink,
  signal: AbortSignal,
  get: ChatStoreGet
): void {
  const pendingRecovery = sseRecoveries.get(threadId)
  if (pendingRecovery?.timer) {
    clearTimeout(pendingRecovery.timer)
    pendingRecovery.timer = undefined
  }
  let terminalError: Error | undefined
  const recoverySink: ThreadEventSink = {
    ...sink,
    onSeq: (seq) => {
      resetSseRecovery(threadId)
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
      scheduleSseRecovery(threadId, terminalError, get)
    })
}

function resetSseRecovery(threadId: string): void {
  const state = sseRecoveries.get(threadId)
  if (state?.timer) clearTimeout(state.timer)
  sseRecoveries.delete(threadId)
}

function scheduleSseRecovery(
  threadId: string,
  error: Error | undefined,
  get: ChatStoreGet
): void {
  const state = sseRecoveries.get(threadId) ?? { attempts: 0 }
  if (state.timer) return
  const decision = decideSseRecovery(sseCloseSignal(error), 0)
  if (decision.strategy === 'none') {
    sseRecoveries.delete(threadId)
    return
  }
  if (decision.strategy === 'authoritative-resync') {
    // seq_conflict (WP-03): the projection cursor is provably dead — the wire
    // regressed below what was already delivered. Compounding idempotent
    // backoff only stalls a thread that cannot advance anyway; reset the
    // attempt accounting and let recoverActiveTurn re-read the authoritative
    // snapshot and re-baseline the cursor right away.
    state.attempts = 1
  } else {
    state.attempts = Math.min(state.attempts + 1, 8)
  }
  const status = sseStatus(error)
  const baseDelay = status === 401 || status === 403
    ? SSE_RECOVERY_AUTH_DELAY_MS
    : SSE_RECOVERY_INITIAL_DELAY_MS
  const delay = Math.min(baseDelay * (2 ** (state.attempts - 1)), SSE_RECOVERY_MAX_DELAY_MS)
  state.timer = setTimeout(() => {
    state.timer = undefined
    const current = get()
    if (current.activeThreadId !== threadId) {
      sseRecoveries.delete(threadId)
      return
    }
    void current.recoverActiveTurn()
  }, delay)
  sseRecoveries.set(threadId, state)
}

function sseStatus(error: Error | undefined): number | undefined {
  const value = error as (Error & { status?: unknown }) | undefined
  return typeof value?.status === 'number' ? value.status : undefined
}

/** Maps a settled subscription outcome onto the shared close-signal shape (WP-03). */
function sseCloseSignal(error: Error | undefined): SseStreamCloseSignal {
  if (!error) return { kind: 'stream-ended' }
  const tagged = error as Error & { status?: unknown; code?: unknown }
  return {
    kind: 'stream-error',
    ...(typeof tagged.status === 'number' ? { status: tagged.status } : {}),
    ...(typeof tagged.code === 'string' ? { code: tagged.code } : {})
  } as SseStreamCloseSignal
}
