import type { RuntimeEventDraft, RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import type { TurnRunOutcome } from './turn-execution-types.js'

/** Start execution first; diagnostic persistence must never strand the turn. */
export function launchContinuationTurn(input: {
  threadId: string
  turnId: string
  runTurn: (threadId: string, turnId: string) => Promise<TurnRunOutcome>
  finishTurn: Pick<TurnService, 'finishTurn'>['finishTurn']
  events: Pick<RuntimeEventRecorder, 'record'>
  diagnostic: RuntimeEventDraft
  log?: (message: string) => void
}): void {
  void Promise.resolve()
    .then(() => input.runTurn(input.threadId, input.turnId))
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error)
      await input.finishTurn({
        threadId: input.threadId,
        turnId: input.turnId,
        status: 'failed',
        error: `Continuation launch failed: ${message}`,
        code: 'continuation_launch_failed',
        severity: 'error'
      }).catch((finishError) => {
        input.log?.(`continuation settlement failed for ${input.threadId}: ${String(finishError)}`)
      })
    })
  void input.events.record(input.diagnostic).catch((error) => {
    input.log?.(`continuation diagnostic failed for ${input.threadId}: ${String(error)}`)
  })
}
