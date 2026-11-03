import { getProvider } from '../agent/registry'
import type { NormalizedThread } from '../agent/types'
import type { PetThreadSupplement } from './pet-activity'

type ListedThread = Pick<NormalizedThread, 'id' | 'title' | 'status' | 'latestTurnId' | 'latestTurnStatus' | 'updatedAt' | 'archived' | 'relation' | 'roomContext'>

/** Code's sidebar drops `relation: 'side'` before the pet publisher can see it. */
export function petConversationSupplements(threads: readonly ListedThread[], already: ReadonlySet<string>): PetThreadSupplement[] {
  return threads.flatMap((thread) => {
    if (already.has(thread.id) || thread.archived || thread.relation !== 'side') return []
    return [{
      threadId: thread.id,
      title: thread.title,
      status: thread.status,
      latestTurnId: thread.latestTurnId,
      latestTurnStatus: thread.latestTurnStatus,
      updatedAt: thread.updatedAt,
      archived: thread.archived,
      roomId: thread.roomContext?.roomId
    }]
  })
}

export async function loadPetConversationThreads(): Promise<NormalizedThread[]> {
  const provider = getProvider()
  if (typeof provider.listThreadsPage !== 'function') return []
  const page = await provider.listThreadsPage({ includeSide: true, limit: 40, lean: true })
  return page.threads
}
