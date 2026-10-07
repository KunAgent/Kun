import { create } from 'zustand'
import type { LastCheck } from './agent-last-check'
import type { AgentInstallObservation } from './agent-center-presentation'

/**
 * What the Agent Center knows about work in flight, shared so the list and
 * the detail speak about the same Agent the same way: an enablement check,
 * an unsaved connection edit, or an install job observed from this window.
 */
type ActivityState = {
  checking: Record<string, true>
  changed: Record<string, true>
  install: Record<string, AgentInstallObservation>
  lastCheck: Record<string, LastCheck>
}

export const useAgentActivityStore = create<ActivityState>(() => ({ checking: {}, changed: {}, install: {}, lastCheck: {} }))

export function setAgentFlag(kind: 'checking' | 'changed', id: string, on: boolean): void {
  useAgentActivityStore.setState((state) => {
    if (Boolean(state[kind][id]) === on) return state
    const next = { ...state[kind] }
    if (on) next[id] = true
    else delete next[id]
    return { [kind]: next } as Pick<ActivityState, typeof kind>
  })
}

export function setAgentInstall(id: string, observation: AgentInstallObservation | undefined): void {
  useAgentActivityStore.setState((state) => {
    const current = state.install[id]
    if (current?.status === observation?.status && current?.action === observation?.action) return state
    const next = { ...state.install }
    if (observation) next[id] = observation
    else delete next[id]
    return { install: next }
  })
}

export function setAgentLastCheck(id: string, check: LastCheck): void {
  useAgentActivityStore.setState((state) => ({ lastCheck: { ...state.lastCheck, [id]: check } }))
}
