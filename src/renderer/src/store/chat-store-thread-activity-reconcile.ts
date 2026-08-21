import type { NormalizedThread } from '../agent/types'
import { threadLooksRunning } from './chat-store-runtime-helpers'

export function normalizeListedThreadActivity<T extends NormalizedThread>(
  threads: T[],
  localThreadById: ReadonlyMap<string, NormalizedThread>
): T[] {
  return threads.map((thread) => {
    if (
      !threadLooksRunning(thread) &&
      thread.status?.trim().toLowerCase() === 'running' &&
      thread.archived !== true
    ) {
      return { ...thread, status: 'idle' } as T
    }
    const localThread = localThreadById.get(thread.id)
    if (
      localThread &&
      !thread.latestTurnStatus &&
      !thread.latestTurnId &&
      localThread.latestTurnStatus
    ) {
      return {
        ...thread,
        status: thread.archived ? thread.status : threadLooksRunning(localThread) ? 'running' : 'idle',
        ...(localThread.latestTurnId ? { latestTurnId: localThread.latestTurnId } : {}),
        ...(localThread.latestTurnStatus ? { latestTurnStatus: localThread.latestTurnStatus } : {})
      } as T
    }
    return thread
  })
}

export function collectRunningWatchTargets(
  threads: readonly NormalizedThread[],
  options: {
    activeThreadId: string | null
    watchTurnCompletion: Record<string, boolean>
    watchLimit: number
  }
): string[] {
  const capacity = Math.max(0, options.watchLimit - Object.keys(options.watchTurnCompletion).length)
  if (capacity === 0) return []
  return threads.flatMap((thread) => {
    if (
      thread.id === options.activeThreadId ||
      thread.archived === true ||
      options.watchTurnCompletion[thread.id] === true ||
      !threadLooksRunning(thread)
    ) return []
    return [thread.id]
  }).slice(0, capacity)
}
