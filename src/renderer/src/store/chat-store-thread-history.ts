import { getProvider } from '../agent/registry'
import { codexReferenceRevision } from '../history-reference/codex-reference-state'
import { formatRuntimeError } from '../lib/format-runtime-error'
import { hydrateBlockModelLabels } from './chat-store-helpers'
import { prependOlderHistoryBlocks, threadActionSharedState } from './chat-store-thread-actions-support'
import { invalidateThreadSnapshot } from './thread-snapshot-cache'
import type { ChatStoreGet, ChatStoreSet } from './chat-store-types'

export async function loadEarlierThreadHistory(set: ChatStoreSet, get: ChatStoreGet): Promise<boolean> {
  const state = get()
  const threadId = state.activeThreadId
  const cursor = state.threadHistoryCursor
  if (
    !threadId ||
    !cursor ||
    !state.threadHasMoreHistory ||
    state.threadHistoryLoading
  ) return false
  const historyRevision = codexReferenceRevision()
  set({ threadHistoryLoading: true })
  try {
    const detail = await getProvider().getThreadDetail(threadId, { before: cursor })
    if (get().activeThreadId !== threadId || historyRevision !== codexReferenceRevision()) return false
    const olderBlocks = hydrateBlockModelLabels(threadId, detail.blocks)
    if (
      detail.hasMoreHistory === true &&
      (!detail.historyCursor || detail.historyCursor === cursor)
    ) {
      throw new Error('thread history cursor did not advance')
    }
    set((current) => {
      if (current.activeThreadId !== threadId) return { threadHistoryLoading: false }
      return {
        blocks: prependOlderHistoryBlocks(current.blocks, olderBlocks),
        threadHistoryCursor: detail.historyCursor ?? null,
        threadHasMoreHistory: detail.hasMoreHistory === true,
        threadHistoryLoading: false,
        turnDurationByUserId: {
          ...current.turnDurationByUserId,
          ...(detail.turnDurationByUserId ?? {})
        }
      }
    })
    threadActionSharedState.expandedHistoryThreadIds.add(threadId)
    // Expanded history can outgrow the projection cache; a later switch
    // safely rehydrates the latest bounded page instead.
    invalidateThreadSnapshot(threadId)
    return true
  } catch (error) {
    if (get().activeThreadId !== threadId || historyRevision !== codexReferenceRevision()) return false
    set({
      threadHistoryLoading: false,
      error: formatRuntimeError(error)
    })
    return false
  }
}
