import type { ThreadExecutionLeasePort } from '../ports/thread-execution-lease.js'
import type { SessionStore } from '../ports/session-store.js'
import type { BackgroundShellRuntime } from '../services/background-shell-runtime.js'
import type { ThreadService } from '../services/thread-service.js'
import type { TurnService } from '../services/turn-service.js'

type Dependencies = {
  turns: Pick<TurnService, 'isTurnExecutionActive'>
  threads: Pick<ThreadService, 'getMetadata'>
  sessions: Pick<SessionStore, 'highestSeq' | 'loadEventsSince'>
  backgroundShells: Pick<BackgroundShellRuntime, 'listSessions' | 'stopSession' | 'stopThread'>
  executionLeases?: Pick<ThreadExecutionLeasePort, 'owner'>
}
const terminal = (status: string) => ['completed', 'failed', 'aborted'].includes(status)

/** Cancellation is turn-scoped; replacement requires the stronger whole-thread proof. */
export function workbenchExecutionControl(deps: Dependencies) {
  const terminalEvidence = async (threadId: string, turnId: string): Promise<boolean> => {
    const thread = await deps.threads.getMetadata(threadId)
    const turn = thread?.turns.find((entry) => entry.id === turnId)
    if (turn) return terminal(turn.status)
    // Lease absence alone does not prove that a missing executor finished.
    const highest = await deps.sessions.highestSeq(threadId)
    const tail = await deps.sessions.loadEventsSince(threadId, Math.max(0, highest - 1000))
    return tail.some((event) => event.turnId === turnId &&
      ['turn_completed', 'turn_failed', 'turn_aborted'].includes(event.kind))
  }
  return {
    stopBackgroundExecution: async (threadId: string, turnId?: string): Promise<void> => {
      if (!turnId) { await deps.backgroundShells.stopThread(threadId); return }
      const sessions = deps.backgroundShells.listSessions(threadId).filter((entry) => entry.turnId === turnId && entry.status === 'running')
      await Promise.allSettled(sessions.map((entry) => deps.backgroundShells.stopSession(entry.id)))
    },
    proveTurnStopped: async (threadId: string, turnId: string): Promise<boolean> => {
      if (deps.turns.isTurnExecutionActive(turnId)) return false
      if (deps.backgroundShells.listSessions(threadId).some((entry) => entry.turnId === turnId && entry.status === 'running')) return false
      if ((await deps.executionLeases?.owner(threadId))?.turnId === turnId) return false
      return terminalEvidence(threadId, turnId)
    },
    proveStopped: async (threadId: string, turnId?: string): Promise<boolean> => {
      if (turnId && deps.turns.isTurnExecutionActive(turnId)) return false
      if (deps.backgroundShells.listSessions(threadId).some((entry) => entry.status === 'running')) return false
      if (await deps.executionLeases?.owner(threadId)) return false
      const thread = await deps.threads.getMetadata(threadId)
      if (thread?.turns.some((turn) => turn.status === 'queued' || turn.status === 'running')) return false
      return !turnId || terminalEvidence(threadId, turnId)
    }
  }
}
