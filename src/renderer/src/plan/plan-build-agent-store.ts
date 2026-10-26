import { create } from 'zustand'
import type { AgentDispatchAssignmentRoute } from '@shared/agent-dispatch'

/**
 * Agent + model the user picked to execute a plan, keyed by plan id. The
 * timeline card and the plan panel share one pick; a plan without an entry
 * builds on the composer's current Agent, exactly as before the picker.
 */
export type PlanBuildHandoff = { route: AgentDispatchAssignmentRoute; threadId: string }

type PlanBuildAgentState = {
  plans: Record<string, AgentDispatchAssignmentRoute>
  /** Plans already handed to an external Agent conversation, for the card's handed-off state. */
  handoffs: Record<string, PlanBuildHandoff>
  setRoute: (planId: string, route: AgentDispatchAssignmentRoute) => void
  clearRoute: (planId: string) => void
  setHandoff: (planId: string, handoff: PlanBuildHandoff) => void
  clearHandoff: (planId: string) => void
}

export const usePlanBuildAgentStore = create<PlanBuildAgentState>((set) => ({
  plans: {},
  handoffs: {},
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
  },
  setHandoff: (planId, handoff) => {
    if (!planId) return
    set((state) => ({ handoffs: { ...state.handoffs, [planId]: handoff } }))
  },
  clearHandoff: (planId) => {
    set((state) => {
      if (!state.handoffs[planId]) return state
      const { [planId]: _removed, ...rest } = state.handoffs
      return { handoffs: rest }
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
