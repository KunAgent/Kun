import { create } from 'zustand'
import type { AgentDispatchAssignmentRoute } from '@shared/agent-dispatch'

/**
 * Agent + model the user picked to execute a plan, keyed by plan id. The
 * timeline card and the plan panel share one pick; a plan without an entry
 * builds on the composer's current Agent, exactly as before the picker.
 */
type PlanBuildAgentState = {
  plans: Record<string, AgentDispatchAssignmentRoute>
  setRoute: (planId: string, route: AgentDispatchAssignmentRoute) => void
  clearRoute: (planId: string) => void
}

export const usePlanBuildAgentStore = create<PlanBuildAgentState>((set) => ({
  plans: {},
  setRoute: (planId, route) => {
    if (!planId) return
    set((state) => ({ plans: { ...state.plans, [planId]: route } }))
  },
  clearRoute: (planId) => {
    set((state) => {
      if (!state.plans[planId]) return state
      const { [planId]: _removed, ...rest } = state.plans
      return { plans: rest }
    })
  }
}))

/** The route a build of this plan would use: the user's pick, else the composer's Agent. */
export function resolvePlanBuildRoute(
  picked: AgentDispatchAssignmentRoute | undefined,
  composer: { harnessId: string; model: string; providerId: string; credentialMode: string }
): AgentDispatchAssignmentRoute {
  if (picked) return picked
  const credentialMode = composer.credentialMode.trim()
  return {
    agentId: composer.harnessId || 'kun',
    ...(composer.model.trim() ? { model: composer.model.trim() } : {}),
    ...(composer.providerId.trim() ? { providerId: composer.providerId.trim() } : {}),
    ...(credentialMode === 'native-login' || credentialMode === 'provider' || credentialMode === 'kun-gateway'
      ? { credentialMode }
      : {})
  }
}
