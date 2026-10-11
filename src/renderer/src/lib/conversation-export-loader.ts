import { getProvider } from '../agent/registry'
import type { ChatBlock } from '../agent/types'
import { prependOlderHistoryBlocks } from '../store/chat-store-thread-actions-support'

const MAX_HISTORY_PAGES = 60

/**
 * Reads a conversation's full durable timeline without touching the active
 * thread: newest page first, then older pages until the runtime has no more.
 */
export type LoadedConversation = {
  blocks: ChatBlock[]
  /** Set while a turn is still running, so the export can leave it out. */
  activeTurnId: string | null
}

export async function loadConversationBlocks(
  threadId: string,
  signal?: AbortSignal
): Promise<LoadedConversation> {
  const provider = getProvider()
  let detail = await provider.getThreadDetail(threadId, { signal, priority: 'background' })
  let blocks = detail.blocks
  const activeTurnId = detail.activeTurn?.id ?? null
  for (let page = 1; page < MAX_HISTORY_PAGES; page += 1) {
    const cursor = detail.historyCursor
    if (detail.hasMoreHistory !== true || !cursor) break
    detail = await provider.getThreadDetail(threadId, { before: cursor, signal, priority: 'background' })
    if (detail.hasMoreHistory === true && detail.historyCursor === cursor) break
    blocks = prependOlderHistoryBlocks(blocks, detail.blocks)
  }
  return { blocks, activeTurnId }
}
