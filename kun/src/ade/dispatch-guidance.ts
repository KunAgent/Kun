import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { HarnessDefinition } from '../contracts/harness.js'
import { shouldAdvertiseNewManagerWork } from '../domain/manager-tools.js'

export const MANAGER_DISPATCH_GUIDANCE = [
  '<kun_agent_dispatch>',
  'You may delegate concrete independent work to configured Agents with harness_list, worker_create, or worker_create_batch.',
  'Choose an enabled, ready Agent with the required capabilities. Set agentSelection to auto when you choose the Agent; use user only when the user explicitly specified it.',
  'Include the assignment, workspace isolation, and acceptance constraints. A dispatch tool saves a durable card; it does not mean the work has finished.',
  'Kun manages confirmation, automatic review, or the 60-second full-access intervention window using this turn\'s permissions. Do not ask for an additional click in automatic modes.',
  'Use dispatch_intent_status to inspect a pending card and dispatch_intent_cancel when the user asks to cancel it before a worker exists.',
  'Continue independent work after dispatch. If none remains, finish this turn and wait for the durable worker update; do not repeatedly poll worker_status.',
  'When a worker update arrives, inspect its outcome and checks, record the acceptance verdict, and summarize the result in this parent conversation.',
  'Automatic replacement is limited to one verified alternative per dispatch. Do not recreate the same failed assignment as new dispatches to bypass that limit or a review rejection; report the outcome and wait for an explicit retry request.',
  '</kun_agent_dispatch>'
].join('\n')

export function dispatchGuidanceForTools(tools: readonly { name: string }[]): string[] {
  return tools.some((tool) => tool.name === 'worker_create') ? [MANAGER_DISPATCH_GUIDANCE] : []
}

/** Delegated session runtimes already validated their effective route at admission. */
export function dispatchGuidanceForTurn(thread: ThreadRecord, turn: Turn, definition: HarnessDefinition): string[] {
  return shouldAdvertiseNewManagerWork({
    harnessId: definition.id,
    managerToolBridgeAvailable: definition.capabilities.statuses.kunTools.supported && definition.capabilities.statuses.abort.supported,
    workspaceMode: thread.workspaceMode,
    collaborationEnabled: turn.collaborationEnabled ?? thread.collaboration?.enabled,
    executionUnitKind: thread.executionUnit?.kind,
    roomAgent: Boolean(thread.roomContext), agentSurface: turn.agentSurface ?? thread.agentSurface,
    clientSurface: turn.clientSurface, imContext: Boolean(turn.imContext)
  }) ? [MANAGER_DISPATCH_GUIDANCE] : []
}
