import { useEffect, useState } from 'react'
import {
  type AppSettingsV1,
  type KunLabAutoPlanBuildSettingsV1
} from '@shared/app-settings'
import { defaultKunLabSettings } from '../../../shared/app-settings-kun-merge'
import { getKunRuntimeSettings } from '../../../shared/app-settings-kun-defaults'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from '../lib/keyboard-shortcut-settings'

export function autoPlanBuildSettingsFromApp(
  settings: AppSettingsV1
): KunLabAutoPlanBuildSettingsV1 {
  return getKunRuntimeSettings(settings).lab.autoPlanBuild
    ?? defaultKunLabSettings().autoPlanBuild
}

export function useAutoPlanBuildSettingsState(): {
  value: KunLabAutoPlanBuildSettingsV1
  loaded: boolean
} {
  const [value, setValue] = useState<KunLabAutoPlanBuildSettingsV1>(
    () => defaultKunLabSettings().autoPlanBuild
  )
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const apply = (settings: AppSettingsV1): void => {
      if (!cancelled) {
        setValue(autoPlanBuildSettingsFromApp(settings))
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

  return { value, loaded }
}

export function useAutoPlanBuildSettings(): KunLabAutoPlanBuildSettingsV1 {
  return useAutoPlanBuildSettingsState().value
}
