import { useEffect, useState } from 'react'
import type { AppSettingsV1 } from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from '../lib/keyboard-shortcut-settings'

export function codexReferenceEnabled(settings: AppSettingsV1): boolean {
  return getKunRuntimeSettings(settings).lab.codexReferenceBranches?.enabled === true
}

export function useCodexReferenceEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let active = true
    const apply = (settings: AppSettingsV1): void => {
      if (active) setEnabled(codexReferenceEnabled(settings))
    }
    void rendererRuntimeClient.getSettings().then(apply).catch(() => undefined)
    const changed = (event: Event): void => {
      const settings = (event as CustomEvent<AppSettingsV1>).detail
      if (settings) apply(settings)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, changed)
    return () => { active = false; window.removeEventListener(SETTINGS_CHANGED_EVENT, changed) }
  }, [])
  return enabled
}
