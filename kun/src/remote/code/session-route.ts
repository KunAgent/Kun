import type { ThreadRecord } from '../../contracts/threads.js'
import type { ThreadExecutionRoute } from '../../contracts/thread-execution-config.js'
import type { StartTurnRequest } from '../../contracts/turns.js'

type Turn = ThreadRecord['turns'][number]

/** A turn whose admission failed never ran on its route, as the turn service's own retry rule says. */
const neverRan = (turn: Turn) => !turn.admissionCompletedAt && (turn.status === 'aborted' || turn.status === 'failed')

function latestAdmitted(thread: Pick<ThreadRecord, 'turns'>): Turn | undefined {
  for (let index = thread.turns.length - 1; index >= 0; index--) {
    const turn = thread.turns[index]
    if (!turn.admissionPending && !neverRan(turn) && turn.model) return turn
  }
  return undefined
}

/**
 * The desktop composer picks the Agent and model per turn without writing them to the task, so a task can run on a
 * route its stored settings do not name. That is the task's route now when the latest admitted turn ran elsewhere and
 * was admitted after the stored route was last chosen; a later settings change wins again.
 */
export function movedTurn(thread: Pick<ThreadRecord, 'turns' | 'model' | 'harnessId' | 'providerId' | 'executionConfig'>): Turn | undefined {
  const turn = latestAdmitted(thread)
  if (!turn?.model) return undefined
  if (thread.executionConfig && Date.parse(turn.createdAt) < Date.parse(thread.executionConfig.resolvedAt)) return undefined
  const same = turn.model === thread.model && (turn.harnessId ?? 'kun') === (thread.harnessId ?? 'kun') &&
    (turn.providerId ?? 'default') === (thread.providerId ?? 'default')
  return same ? undefined : turn
}

/** A turn's frozen route in the shape of a task route. */
export function turnRoute(turn: Turn): ThreadExecutionRoute {
  return { model: turn.model!, ...(turn.providerId ? { providerId: turn.providerId } : {}),
    ...(turn.harnessId ? { harnessId: turn.harnessId } : {}), ...(turn.credentialMode ? { credentialMode: turn.credentialMode } : {}),
    ...(turn.gatewayBinding ? { gatewayBinding: turn.gatewayBinding } : {}),
    ...(turn.reasoningEffort ? { reasoningEffort: turn.reasoningEffort } : {}) }
}

/** The Agent, model and provider a task listing shows: the route the task is on now. */
export function sessionRoute(thread: ThreadRecord): Pick<ThreadRecord, 'model' | 'harnessId' | 'providerId'> {
  const turn = movedTurn(thread)
  return turn ? { model: turn.model!, harnessId: turn.harnessId, providerId: turn.providerId }
    : { model: thread.model, harnessId: thread.harnessId, providerId: thread.providerId }
}

/**
 * Request fields that keep a phone turn on the route the desktop moved the task to, copied from that turn as the
 * desktop's own continuations do. The mode goes with it because an external Agent refuses the plan mode the desktop
 * switches away from. A gateway alias names its model itself, so it is sent without model or provider.
 */
export function continuationRoute(turn: Turn): Partial<StartTurnRequest> {
  return {
    ...(turn.gatewayBinding ? { gatewayBinding: turn.gatewayBinding } : { model: turn.model, providerId: turn.providerId }),
    harnessId: turn.harnessId, credentialMode: turn.credentialMode, accountId: turn.accountId,
    harnessAgentId: turn.harnessAgentId, harnessSettings: turn.harnessSettings, reasoningEffort: turn.reasoningEffort,
    mode: turn.mode
  }
}
