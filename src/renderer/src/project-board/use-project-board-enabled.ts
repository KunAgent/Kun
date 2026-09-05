import { useEffect, useState } from 'react'
import type { AppSettingsV1 } from '@shared/app-settings'
import { defaultKunLabSettings } from '../../../shared/app-settings-kun-merge'
import { getKunRuntimeSettings } from '../../../shared/app-settings-kun-defaults'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from '../lib/keyboard-shortcut-settings'

export function projectBoardEnabledFromApp(settings: AppSettingsV1): boolean {
  return getKunRuntimeSettings(settings).lab.projectBoard?.enabled
    ?? defaultKunLabSettings().projectBoard.enabled
}

export function useProjectBoardEnabled(): { enabled: boolean; loaded: boolean } {
  const [enabled, setEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const apply = (settings: AppSettingsV1): void => {
      if (!cancelled) {
        setEnabled(projectBoardEnabledFromApp(settings))
        setLoaded(true)
      }
    }
    void rendererRuntimeClient.getSettings().then(apply).catch(() => undefined)
    const onSettingsChanged = (event: Event): void => {
      const settings = (event as CustomEvent<AppSettingsV1>).detail
      if (settings) apply(settings)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])

  return { enabled, loaded }
}
