import { runWithoutTurnMutationFence } from '../manager/turn-mutation-context.js'
import type { ExecutionTaskService } from '../services/execution-task-service.js'
import type { TerminalTurnStatus } from '../services/turn-service.js'
import type { QueuedTurnDispatcher } from './queued-turn-dispatcher.js'

/** Keep Stop's admission fence synchronous; task projection is post-settlement work. */
export function createExecutionTaskTurnSettledHook(
  tasks: Pick<ExecutionTaskService, 'reconcileAfterTurn'>,
  dispatcher: Pick<QueuedTurnDispatcher, 'onTurnSettled'>
): (threadId: string, status: TerminalTurnStatus) => Promise<void> {
  return async (threadId, status) => {
    // A store/event delay must not let another dispatcher wake promote this
    // thread's queued work after the user has pressed Stop.
    if (status === 'aborted') dispatcher.onTurnSettled(threadId, status)
    try {
      await runWithoutTurnMutationFence(() => tasks.reconcileAfterTurn(threadId))
    } finally {
      if (status !== 'aborted') dispatcher.onTurnSettled(threadId, status)
    }
  }
}
