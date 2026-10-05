import { latestExecutedTurn } from '../domain/queue-execution-state.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { TurnService } from './turn-service-core.js'
import { TurnConflictError } from './turn-service-core.js'

/** Durable queue admission barrier. Enqueue and scheduler wakes never grant resume. */
export const turnServiceQueueControlOperations = {
  async pauseQueuedTurns(this: TurnService, threadId: string, reason: 'user_stop' | 'restart_recovery', sourceTurnId: string): Promise<void> {
    await this['withQueueDataMutation'](threadId, async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const thread = await this['deps'].threadStore.get(threadId)
        if (!thread) throw new Error(`thread not found: ${threadId}`)
        // Recovery must never override an explicit user Stop.
        if (thread.queueControl?.reason === 'user_stop' && reason !== 'user_stop') return
        if (reason === 'restart_recovery' && (latestExecutedTurn(thread)?.id !== sourceTurnId ||
          thread.queueResumeSourceTurnId === sourceTurnId)) return
        const next: ThreadRecord = { ...thread, queueControl: {
          reason, sourceTurnId, pausedAt: this['deps'].nowIso()
        } }
        if ((await this['commitThreadRecordCAS'](next, thread.revision ?? 0)).applied) return
      }
      throw new TurnConflictError(`thread changed while pausing queue: ${threadId}`)
    })
  },

  async resumeQueuedTurns(this: TurnService, threadId: string): Promise<void> {
    await this['withQueueDataMutation'](threadId, async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const thread = await this['deps'].threadStore.get(threadId)
        if (!thread) throw new Error(`thread not found: ${threadId}`)
        const sourceTurnId = thread.queueControl?.sourceTurnId ?? latestExecutedTurn(thread)?.id
        if (!thread.queueControl && !sourceTurnId) return
        const next = { ...thread, queueControl: undefined, queueResumeSourceTurnId: sourceTurnId }
        if ((await this['commitThreadRecordCAS'](next, thread.revision ?? 0)).applied) return
      }
      throw new TurnConflictError(`thread changed while resuming queue: ${threadId}`)
    })
  }
}
