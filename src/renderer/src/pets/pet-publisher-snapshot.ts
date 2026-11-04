import { PET_ACTIVITY_MAX_ITEMS, type PetActivitySnapshot } from '@shared/pets'
import type { ChatState } from '../store/chat-store-types'
import type { PetThreadSupplement } from './pet-activity'

/** Confirmed live state can arrive before sidebar metadata or the optional ADE feed. */
export function currentPetThread(state: ChatState): PetThreadSupplement | null {
  if (!state.activeThreadId || !state.busy || state.busyUnconfirmed) return null
  const thread = state.threads.find((item) => item.id === state.activeThreadId)
  if (thread?.archived) return null
  const waiting = state.awaitingUserInputThreadIds[state.activeThreadId] || state.blocks.some((block) => {
    if (state.currentTurnId && block.turnId && block.turnId !== state.currentTurnId) return false
    return (block.kind === 'approval' && (block.status === 'pending' || block.status === 'submitting')) ||
      (block.kind === 'user_input' && block.status === 'pending' && block.live === true)
  })
  const startedAt = (state.currentTurnUserId ? state.turnStartedAtByUserId[state.currentTurnUserId] : undefined)
    ?? state.currentTurnStartedAtMs
  return {
    threadId: state.activeThreadId,
    title: thread?.title || 'Chat',
    latestTurnId: state.currentTurnId ?? undefined,
    latestTurnStatus: waiting ? 'waiting' : 'running',
    updatedAt: typeof startedAt === 'number' && Number.isFinite(startedAt)
      ? new Date(startedAt).toISOString()
      : thread?.updatedAt,
    roomId: thread?.roomContext?.roomId
  }
}

/** Stay within the Main IPC contract without letting old results crowd out live work. */
export function petSnapshotForDelivery(snapshot: PetActivitySnapshot, activeThreadId: string | null): PetActivitySnapshot {
  if (snapshot.items.length <= PET_ACTIVITY_MAX_ITEMS) return snapshot
  const live = (status: string): number => Number(status === 'running' || status === 'waiting')
  const items = [...snapshot.items].sort((a, b) =>
    Number(b.bubbleAllowed) - Number(a.bubbleAllowed) ||
    Number(b.threadId === activeThreadId) - Number(a.threadId === activeThreadId) ||
    live(b.status) - live(a.status) ||
    b.updatedAtMs - a.updatedAtMs
  ).slice(0, PET_ACTIVITY_MAX_ITEMS)
  return { ...snapshot, items }
}
