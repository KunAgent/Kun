import { useEffect, useState } from 'react'
import type { AppSettingsV1 } from '@shared/app-settings'
import { getKunRuntimeSettings } from '../../../shared/app-settings-kun-defaults'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from '../lib/keyboard-shortcut-settings'

export function nodeGraphEnabledFromApp(settings: AppSettingsV1): boolean {
  return getKunRuntimeSettings(settings).lab?.nodeGraph?.enabled === true
}

/** Fail closed until settings arrive; live saves take precedence over initial reads. */
export function useNodeGraphEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let cancelled = false
    let changed = false
    const onSettingsChanged = (event: Event): void => {
      const settings = (event as CustomEvent<AppSettingsV1>).detail
      if (!settings) return
      changed = true
      setEnabled(nodeGraphEnabledFromApp(settings))
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    void rendererRuntimeClient.getSettings().then((settings) => {
      if (!cancelled && !changed) setEnabled(nodeGraphEnabledFromApp(settings))
    }).catch(() => undefined)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])
  return enabled
}
