import { create } from 'zustand'
import type { AgentDispatchAssignmentRoute } from '@shared/agent-dispatch'

/**
 * Agent + model the user picked to execute a plan, keyed by plan id. The
 * timeline card and the plan panel share one pick; a plan without an entry
 * builds on the composer's current Agent, exactly as before the picker.
 */
export type PlanBuildRoute = AgentDispatchAssignmentRoute & {
  /** Reasoning level for the build turn; absent or `auto` leaves it to the Agent. */
  reasoningEffort?: string
}

/** A plan handed to an external Agent conversation (now, or by a scheduled run). */
export type PlanBuildHandoff = {
  route: PlanBuildRoute
  threadId: string
  workspaceId?: string
  planTitle?: string
  planPath?: string
  /** Conversation the plan was written in, for the way back. */
  sourceThreadId?: string
  startedAt?: number
}

/** Why the last handoff of a plan did not start; shown on the card itself. */
export type PlanBuildFailure = { agentId: string; message: string }

type PlanBuildAgentState = {
  plans: Record<string, PlanBuildRoute>
  /** Plans already handed to an external Agent conversation, for the card's handed-off state. */
  handoffs: Record<string, PlanBuildHandoff>
  failures: Record<string, PlanBuildFailure>
  setRoute: (planId: string, route: PlanBuildRoute) => void
  clearRoute: (planId: string) => void
  setHandoff: (planId: string, handoff: PlanBuildHandoff) => void
  clearHandoff: (planId: string) => void
  setFailure: (planId: string, failure: PlanBuildFailure | null) => void
}

const STORAGE_KEY = 'kun.planBuildAgent.v1'
const MAX_PERSISTED = 60

type Persisted = Pick<PlanBuildAgentState, 'plans' | 'handoffs'>

function readPersisted(): Persisted {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as Partial<Persisted> : {}
    const record = (value: unknown): Record<string, never> =>
      value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, never> : {}
    return { plans: record(parsed.plans), handoffs: record(parsed.handoffs) }
  } catch {
    return { plans: {}, handoffs: {} }
  }
}

function newest<T>(entries: Record<string, T>): Record<string, T> {
  const keys = Object.keys(entries)
  return keys.length <= MAX_PERSISTED ? entries : Object.fromEntries(keys.slice(-MAX_PERSISTED).map((key) => [key, entries[key]]))
}

function writePersisted(state: Persisted): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({
      plans: newest(state.plans), handoffs: newest(state.handoffs)
    }))
  } catch {
    // Storage is a convenience: the pick still works for this session.
  }
}

function without<T>(entries: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = entries
  return rest
}

export const usePlanBuildAgentStore = create<PlanBuildAgentState>((set, get) => {
  const persist = (): void => writePersisted(get())
  return {
    ...readPersisted(),
    failures: {},
    setRoute: (planId, route) => {
      if (!planId) return
      set((state) => ({ plans: { ...state.plans, [planId]: route }, failures: without(state.failures, planId) }))
      persist()
    },
    clearRoute: (planId) => {
      if (!get().plans[planId]) return
      set((state) => ({ plans: without(state.plans, planId) }))
      persist()
    },
    setHandoff: (planId, handoff) => {
      if (!planId) return
      set((state) => ({ handoffs: { ...state.handoffs, [planId]: handoff }, failures: without(state.failures, planId) }))
      persist()
    },
    clearHandoff: (planId) => {
      if (!get().handoffs[planId]) return
      set((state) => ({ handoffs: without(state.handoffs, planId) }))
      persist()
    },
    setFailure: (planId, failure) => {
      if (!planId) return
      set((state) => ({ failures: failure ? { ...state.failures, [planId]: failure } : without(state.failures, planId) }))
    }
  }
})

/** The plan handoff that opened this conversation, if any. */
export function planBuildHandoffForThread(
  handoffs: Record<string, PlanBuildHandoff>,
  threadId: string | null | undefined
): { planId: string; handoff: PlanBuildHandoff } | null {
  if (!threadId) return null
  for (const [planId, handoff] of Object.entries(handoffs)) {
    if (handoff.threadId === threadId) return { planId, handoff }
  }
  return null
}

/** Effort the turn should request; `auto` and blanks leave it to the Agent. */
export function planBuildReasoningEffort(route: PlanBuildRoute | undefined): string | undefined {
  const effort = route?.reasoningEffort?.trim()
  return effort && effort !== 'auto' ? effort : undefined
}

/** The route a build of this plan would use: the user's pick, else the composer's Agent. */
export function resolvePlanBuildRoute(
  picked: PlanBuildRoute | undefined,
  composer: { harnessId: string; model: string; providerId: string; credentialMode: string; reasoningEffort?: string }
): PlanBuildRoute {
  if (picked) return picked
  const credentialMode = composer.credentialMode.trim()
  const effort = composer.reasoningEffort?.trim()
  return {
    agentId: composer.harnessId || 'kun',
    ...(composer.model.trim() ? { model: composer.model.trim() } : {}),
    ...(composer.providerId.trim() ? { providerId: composer.providerId.trim() } : {}),
    ...(credentialMode === 'native-login' || credentialMode === 'provider' || credentialMode === 'kun-gateway'
      ? { credentialMode }
      : {}),
    ...(effort ? { reasoningEffort: effort } : {})
  }
}
