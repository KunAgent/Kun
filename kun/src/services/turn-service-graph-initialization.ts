import type { GraphPlanningLifecycle } from '../contracts/turns.js'
import type { TurnServiceDeps } from './turn-service-core.js'

/** Runs under the admission/promotion thread lock, before running is published. */
export async function initializeGraphPlanning(
  deps: Pick<TurnServiceDeps, 'createGraphPlanningDraft' | 'resolveGraphPlanningDraft'>,
  input: {
    threadId: string
    sourceTurnId: string
    goal: string
    workspace?: string
  },
  lifecycle?: GraphPlanningLifecycle
): Promise<GraphPlanningLifecycle | undefined> {
  // A failed thread CAS may leave a durable draft without turn metadata. Resolve
  // by source turn first so retries/restarts reuse that draft and reserved run.
  const existing = await deps.resolveGraphPlanningDraft?.({
    threadId: input.threadId,
    sourceTurnId: input.sourceTurnId
  })
  return existing ?? lifecycle ?? await deps.createGraphPlanningDraft?.(input)
}
