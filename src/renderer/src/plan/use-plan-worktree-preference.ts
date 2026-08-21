import { useEffect } from 'react'
import { DEFAULT_GIT_BRANCH_PREFIX, type AppSettingsV1 } from '@shared/app-settings'
import { getKunRuntimeSettings } from '../../../shared/app-settings-kun-defaults'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from '../lib/keyboard-shortcut-settings'
import type { GuiPlanArtifact } from './plan-store'
import {
  usePlanWorktreePreferenceStore,
  type PlanWorktreePreference
} from './plan-worktree-preference-store'

function settingsValues(settings: AppSettingsV1): {
  useWorktreeByDefault: boolean
  branchPrefix: string
} {
  return {
    useWorktreeByDefault: getKunRuntimeSettings(settings).planExecution.useWorktreeByDefault,
    branchPrefix: settings.gitBranchPrefix || DEFAULT_GIT_BRANCH_PREFIX
  }
}

export function usePlanWorktreePreference(
  plan: GuiPlanArtifact | null
): PlanWorktreePreference | undefined {
  const planId = plan?.id ?? ''
  const preference = usePlanWorktreePreferenceStore((state) =>
    planId ? state.plans[planId] : undefined)

  useEffect(() => {
    if (typeof window.addEventListener !== 'function') return
    const onSettingsChanged = (event: Event): void => {
      const settings = (event as CustomEvent<AppSettingsV1>).detail
      if (!settings) return
      const values = settingsValues(settings)
      usePlanWorktreePreferenceStore.getState().syncSettings(
        values.useWorktreeByDefault,
        values.branchPrefix
      )
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
  }, [])

  useEffect(() => {
    if (!plan) return
    if (usePlanWorktreePreferenceStore.getState().plans[plan.id]?.initialized) return
    let cancelled = false
    void rendererRuntimeClient.getSettings().then((settings) => {
      if (cancelled) return
      const values = settingsValues(settings)
      const store = usePlanWorktreePreferenceStore.getState()
      if (!store.plans[plan.id]?.initialized) {
        store.initializePlan(plan.id, values.useWorktreeByDefault, values.branchPrefix)
      }
    }).catch(() => {
      if (cancelled) return
      const store = usePlanWorktreePreferenceStore.getState()
      if (!store.plans[plan.id]?.initialized) {
        store.initializePlan(plan.id, true, DEFAULT_GIT_BRANCH_PREFIX)
      }
    })
    return () => { cancelled = true }
  }, [plan])

  return preference
}
