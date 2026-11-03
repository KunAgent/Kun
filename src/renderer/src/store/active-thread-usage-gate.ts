import type { ChatState } from './chat-store-types'
import { listedThreadEmptiness } from './chat-store-runtime-helpers'

type UsageGateState = Pick<ChatState,
  'activeThreadId' | 'blocks' | 'busy' | 'threadLoadingId' | 'threads' | 'adeThreads' | 'lastTurnUsage'>

/**
 * A thread that never accepted a turn has no usage to show. New task opens
 * such a thread, and several panels would otherwise each ask Kun for its usage
 * while the runtime is busiest. Content, a running turn or live usage enable
 * the requests again on their own.
 */
export function activeThreadMayHaveUsage(state: UsageGateState): boolean {
  const id = state.activeThreadId
  if (!id) return false
  if (state.busy || state.blocks.length > 0 || state.lastTurnUsage?.threadId === id) return true
  if (state.threadLoadingId !== id) return false
  // Still hydrating: only the list can tell that the thread is empty.
  const thread = state.threads.find((entry) => entry.id === id) ??
    (state.adeThreads ?? []).find((entry) => entry.id === id)
  return !thread || listedThreadEmptiness(thread) !== 'empty'
}
