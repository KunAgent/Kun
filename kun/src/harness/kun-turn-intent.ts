import type { StartTurnRequest } from '../contracts/turns.js'
import type { Turn } from '../contracts/turns.js'
import type { ThreadRecord } from '../contracts/threads.js'

type KunTurnIntent = Pick<StartTurnRequest,
  | 'agentSurface' | 'guiDesignMode' | 'guiDesignCanvas' | 'guiExcalidrawCanvas'
  | 'designProfile' | 'designDocumentTarget' | 'designImagePlacementTarget'
  | 'guiDesignArtifact' | 'guiPlan' | 'planBuild' | 'orchestration' | 'mode'>

/** Old turns can omit fields that the execution context inherits from their thread. */
export function effectiveKunTurnIntent(
  thread: Pick<ThreadRecord, 'agentSurface' | 'mode'>,
  turn: KunTurnIntent
): KunTurnIntent {
  return { ...turn, agentSurface: turn.agentSurface ?? thread.agentSurface, mode: turn.mode ?? thread.mode }
}

/** Missing Lead metadata alone is not proof that a persisted Graph turn is a worker. */
export function isInternalGraphWorker(
  thread: Pick<ThreadRecord, 'relation' | 'parentThreadId' | 'executionUnit'>,
  turn: Pick<Turn, 'graphLeadLifecycle' | 'graphPlanningLifecycle'> = {}
): boolean {
  return !turn.graphLeadLifecycle && !turn.graphPlanningLifecycle && Boolean(
    thread.executionUnit?.kind === 'worker' || (thread.relation === 'side' && thread.parentThreadId)
  )
}

/** Product workflows belong to Kun even when an external engine exposes Kun tools. */
export function unsupportedKunTurnIntent(
  harnessId: string,
  intent: KunTurnIntent,
  options: { graphWorker?: boolean } = {}
): string | undefined {
  if (harnessId === 'kun') return undefined
  if (intent.agentSurface === 'design' || intent.guiDesignMode || intent.guiDesignCanvas ||
    intent.guiExcalidrawCanvas || intent.designProfile || intent.designDocumentTarget ||
    intent.designImagePlacementTarget || intent.guiDesignArtifact) {
    return 'Kun Design and canvas workflows require Kun Agent. Select Kun to continue.'
  }
  if ((intent.orchestration === 'graph' && !options.graphWorker) ||
    intent.guiPlan || intent.planBuild || intent.mode === 'plan') {
    return 'Kun Graph and plan workflows require Kun Agent. Select Kun to continue.'
  }
  // `code` is also the legacy carrier for ordinary external Agent messages.
  return undefined
}
