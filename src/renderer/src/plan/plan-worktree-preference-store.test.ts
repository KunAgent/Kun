import { beforeEach, describe, expect, it } from 'vitest'
import {
  resetPlanWorktreePreferenceStoreForTests,
  usePlanWorktreePreferenceStore
} from './plan-worktree-preference-store'

describe('plan worktree preference store', () => {
  beforeEach(() => resetPlanWorktreePreferenceStoreForTests())

  it('defaults each plan from the formal worktree preference', () => {
    const store = usePlanWorktreePreferenceStore.getState()
    store.initializePlan('default', true, 'codex/')
    store.initializePlan('opt-out', false, 'kun/')

    expect(usePlanWorktreePreferenceStore.getState().plans).toMatchObject({
      default: { usePromptWorktree: true, overridden: false, branchPrefix: 'codex/' },
      'opt-out': { usePromptWorktree: false, overridden: false, branchPrefix: 'kun/' }
    })
  })

  it('preserves a per-plan override when the global default changes', () => {
    const store = usePlanWorktreePreferenceStore.getState()
    store.initializePlan('plan', true, 'codex/')
    store.setUsePromptWorktree('plan', false)
    store.syncSettings(true, 'team/')

    expect(usePlanWorktreePreferenceStore.getState().plans.plan).toMatchObject({
      usePromptWorktree: false,
      overridden: true,
      branchPrefix: 'team/'
    })
  })

  it('updates plans that have not been overridden', () => {
    const store = usePlanWorktreePreferenceStore.getState()
    store.initializePlan('plan', true, 'codex/')
    store.syncSettings(false, 'codex/')

    expect(usePlanWorktreePreferenceStore.getState().plans.plan?.usePromptWorktree).toBe(false)
  })
})
