import { useRef } from 'react'
import type { AppSettingsV1, KunHarnessSettingsV1 } from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { normalizeKunHarnessSettings } from '@shared/app-settings-kun-harness'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { emitRendererSettingsChanged } from '../../lib/keyboard-shortcut-settings'
import { applyHarnessEnablementSettings, harnessIdsWithChangedLaunchSettings } from '../../store/harness-store'

export function onboardingHarnessSettings(settings: AppSettingsV1): KunHarnessSettingsV1 {
  return normalizeKunHarnessSettings(getKunRuntimeSettings(settings).harnesses)
}

/**
 * The Agents step persists harness enablement straight to settings, the way
 * Settings › Agents does through its auto-save. Writes are chained so a fast
 * second activation never races the first, and `beforeCheck` resolves only
 * once every pending write landed (the readiness gate polls for it next).
 */
export function useOnboardingHarnessSettings(input: {
  getForm: () => AppSettingsV1 | null
  setForm: (next: AppSettingsV1) => void
}): {
  patch: (patch: Partial<KunHarnessSettingsV1>) => void
  beforeCheck: () => Promise<boolean>
} {
  const pending = useRef<Promise<boolean>>(Promise.resolve(true))
  const latest = useRef(input)
  latest.current = input

  const patch = (change: Partial<KunHarnessSettingsV1>): void => {
    const current = latest.current.getForm()
    if (!current) return
    const previous = onboardingHarnessSettings(current)
    const harnesses = { ...previous, ...change }
    applyHarnessEnablementSettings(harnesses, harnessIdsWithChangedLaunchSettings(previous, harnesses))
    latest.current.setForm({
      ...current,
      agents: { ...current.agents, kun: { ...current.agents.kun, harnesses } }
    })
    pending.current = pending.current
      .catch(() => false)
      .then(async () => {
        const saved = await rendererRuntimeClient.setSettings({ agents: { kun: { harnesses } } })
        latest.current.setForm(saved)
        emitRendererSettingsChanged(saved)
        return true
      })
      .catch(() => false)
  }

  return { patch, beforeCheck: () => pending.current }
}
