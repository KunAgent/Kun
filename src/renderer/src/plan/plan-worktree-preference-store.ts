import { create } from 'zustand'

export type PlanWorktreePreference = {
  initialized: boolean
  /** Legacy test/store input; no runtime behavior reads this value. */
  featureEnabled?: boolean
  usePromptWorktree: boolean
  overridden?: boolean
  branchPrefix: string
}

type PlanWorktreePreferenceState = {
  plans: Record<string, PlanWorktreePreference>
  initializePlan: (planId: string, useWorktreeByDefault: boolean, branchPrefix: string) => void
  syncSettings: (useWorktreeByDefault: boolean, branchPrefix: string) => void
  setUsePromptWorktree: (planId: string, enabled: boolean) => void
}

function initialPreference(
  useWorktreeByDefault = true,
  branchPrefix = 'codex/'
): PlanWorktreePreference {
  return {
    initialized: false,
    usePromptWorktree: useWorktreeByDefault,
    overridden: false,
    branchPrefix
  }
}

export const usePlanWorktreePreferenceStore = create<PlanWorktreePreferenceState>((set) => ({
  plans: {},

  initializePlan: (planId, useWorktreeByDefault, branchPrefix) => {
    set((state) => {
      if (state.plans[planId]?.initialized) return state
      return {
        plans: {
          ...state.plans,
          [planId]: {
            ...initialPreference(useWorktreeByDefault, branchPrefix),
            initialized: true
          }
        }
      }
    })
  },

  syncSettings: (useWorktreeByDefault, branchPrefix) => {
    set((state) => ({
      plans: Object.fromEntries(Object.entries(state.plans).map(([planId, current]) => [planId, {
        ...current,
        branchPrefix,
        usePromptWorktree: current.overridden === true
          ? current.usePromptWorktree
          : useWorktreeByDefault
      }]))
    }))
  },

  setUsePromptWorktree: (planId, enabled) => {
    set((state) => {
      const current = state.plans[planId] ?? initialPreference()
      return {
        plans: {
          ...state.plans,
          [planId]: {
            ...current,
            initialized: true,
            overridden: true,
            usePromptWorktree: enabled
          }
        }
      }
    })
  }
}))

export function resetPlanWorktreePreferenceStoreForTests(): void {
  usePlanWorktreePreferenceStore.setState({ plans: {} })
}
