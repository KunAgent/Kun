import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'

/**
 * Harness usage scenarios drive the admission matrix (02 §5.1). They describe
 * what the surrounding Kun feature needs from a harness, not which client
 * rendered the prompt.
 */
export const HARNESS_USAGES = [
  'one-to-one',
  'manager-worker',
  'graph-worker',
  'graph-lead',
  'room-execution',
  'scheduled',
  'im',
  'plan-build',
  'design'
] as const
export type HarnessUsage = (typeof HARNESS_USAGES)[number]

/** Thread field added by task workspaces (P0-10); absent until then. */
type ExecutionUnitCarrier = { executionUnit?: { kind?: string } }

/**
 * Derive the admission usage for a turn from the owning thread and the frozen
 * turn fields. Ordering matters: rooms and Graph outrank manager-worker and
 * the unattended/IM cases below them.
 */
export function usageForTurn(
  thread: Pick<ThreadRecord, 'roomContext'>,
  turn: Pick<
    Turn,
    | 'orchestration'
    | 'graphLeadLifecycle'
    | 'graphPlanningLifecycle'
    | 'imContext'
    | 'clientSurface'
    | 'disableUserInput'
    | 'agentSurface'
  >
): HarnessUsage {
  if (thread.roomContext) return 'room-execution'
  if (turn.orchestration === 'graph') {
    return turn.graphLeadLifecycle || turn.graphPlanningLifecycle
      ? 'graph-lead'
      : 'graph-worker'
  }
  if ((thread as ExecutionUnitCarrier).executionUnit?.kind === 'worker') {
    return 'manager-worker'
  }
  if (turn.imContext === true || turn.clientSurface === 'im') return 'im'
  if (turn.disableUserInput === true) return 'scheduled'
  if (turn.agentSurface === 'design') return 'design'
  return 'one-to-one'
}

/**
 * Sole unattended criterion: IM and headless/scheduled runs both set these
 * turn flags (turns carry no scheduled-task id).
 */
export const isUnattendedTurn = (
  turn: Pick<Turn, 'disableUserInput' | 'imContext'>
): boolean => turn.disableUserInput === true || turn.imContext === true
